import { validate } from './model.mjs';

const copy = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const meaningful = day => !!(day.notes.trim() || day.tasks.some(t => t.text.trim() || t.done) ||
  [...day.plans, ...day.actuals].some(r => r.text.trim() || r.start || r.end || r.study));

export class NotebookStore {
  constructor(storage, owner) {
    this.storage = storage;
    this.key = `shijian-account-v1:${owner}`;
    const saved = storage.getItem(this.key);
    this.state = saved ? JSON.parse(saved) : { days: {}, revisions: {}, dirty: {}, conflicts: {} };
    validate({ version: 2, days: this.state.days });
    for (const field of ['revisions', 'dirty', 'conflicts']) {
      if (!this.state[field] || typeof this.state[field] !== 'object' || Array.isArray(this.state[field])) {
        throw Error('本机账号记录无法读取，请先导出备份。');
      }
    }
    for (const revision of Object.values(this.state.revisions)) {
      if (!Number.isSafeInteger(revision) || revision < 0) throw Error('本机同步版本无法读取。');
    }
  }
  persist() { this.storage.setItem(this.key, JSON.stringify(this.state)); }
  get data() { return { version: 2, days: this.state.days }; }
  get pending() { return Object.keys(this.state.dirty).length; }
  edit(date, content) {
    validate({ version: 2, days: { [date]: content } });
    if (this.state.days[date] !== content) this.state.days[date] = copy(content);
    this.state.dirty[date] = true;
    this.persist();
  }
  receive(rows) {
    for (const row of rows) {
      validate({ version: 2, days: { [row.day]: row.content } });
      if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw Error('云端版本号无效。');
      const date = row.day;
      if (this.state.dirty[date]) {
        if (equal(this.state.days[date], row.content)) {
          this.state.revisions[date] = row.revision;
          delete this.state.dirty[date];
          delete this.state.conflicts[date];
        } else if (row.revision !== (this.state.revisions[date] || 0)) {
          this.state.conflicts[date] = copy(row);
        }
      } else {
        this.state.days[date] = copy(row.content);
        this.state.revisions[date] = row.revision;
        delete this.state.conflicts[date];
      }
    }
    this.persist();
  }
  resolve(date, choice) {
    const remote = this.state.conflicts[date];
    if (!remote) return;
    if (!['local', 'cloud'].includes(choice)) throw Error('请选择要保留的版本。');
    // Retain both versions locally before replacing either one.
    const backupKey = `${this.key}:conflict-backups`;
    const backups = JSON.parse(this.storage.getItem(backupKey) || '[]');
    backups.push({ date, savedAt: new Date().toISOString(), local: copy(this.state.days[date]), cloud: copy(remote) });
    this.storage.setItem(backupKey, JSON.stringify(backups));
    this.state.revisions[date] = remote.revision;
    if (choice === 'cloud') {
      this.state.days[date] = copy(remote.content);
      delete this.state.dirty[date];
    } else this.state.dirty[date] = true;
    delete this.state.conflicts[date];
    this.persist();
  }
  importDays(incoming) {
    validate(incoming);
    for (const [date, content] of Object.entries(incoming.days)) {
      if (!meaningful(content)) continue;
      const previous = this.state.days[date];
      if (previous && meaningful(previous) && !equal(previous, content)) {
        // Import is explicit, but overlaps still require a version choice.
        this.state.conflicts[date] = { day: date, content: copy(previous), revision: this.state.revisions[date] || 0 };
      }
      this.state.days[date] = copy(content);
      this.state.dirty[date] = true;
    }
    this.persist();
  }
}

export class SyncEngine {
  constructor(store, api, onChange = () => {}) {
    this.store = store;
    this.api = api;
    this.onChange = onChange;
    this.stopped = false;
    this.running = null;
  }
  stop() { this.stopped = true; }
  sync() {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  async run() {
    const rows = await this.api.list();
    if (this.stopped) return;
    this.store.receive(rows);
    for (const date of Object.keys(this.store.state.dirty)) {
      if (this.stopped) return;
      if (this.store.state.conflicts[date]) continue;
      const content = copy(this.store.state.days[date]);
      const revision = this.store.state.revisions[date] || 0;
      try {
        const savedRevision = await this.api.save(date, content, revision);
        if (this.stopped) return;
        this.store.state.revisions[date] = savedRevision;
        // Edits made during the network request must remain queued.
        if (equal(this.store.state.days[date], content)) delete this.store.state.dirty[date];
        this.store.persist();
      } catch (error) {
        if (error.code !== '40001') throw error;
        const remote = await this.api.get(date);
        if (this.stopped) return;
        if (remote) this.store.receive([remote]);
      }
    }
    this.onChange();
  }
}
