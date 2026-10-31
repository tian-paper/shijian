import { client, configured, journalApi } from './cloud.mjs';
import { NotebookStore, SyncEngine, meaningful } from './sync.mjs';

export function initAccounts({ getData, setData, refresh, report }) {
  const $ = id => document.getElementById(id);
  let user = null, store = null, engine = null, timer = null, busy = false, generation = 0;
  let guest = structuredClone(getData());
  let guestRaw = localStorage.getItem('time-journal-notebook-v2');
  const open = id => { if (!$(id).open) $(id).showModal(); };
  const editing = () => document.activeElement?.matches('main input, main textarea');
  const signed = () => !!user;
  function status(text) {
    const conflicts = store ? Object.keys(store.state.conflicts).length : 0;
    $('status').dataset.conflict = String(!!conflicts);
    $('status').textContent = text || (conflicts ? `${conflicts} 天待选择版本` :
      store?.pending ? `本机已保存 · ${store.pending} 天待同步` :
      user ? '已同步' : '已保存到本机');
  }
  function accountView() {
    $('account').textContent = user ? '我的账号' : '登录';
    $('userAvatar').classList.toggle('signed-in', !!user);
    $('userAvatar').title = user ? '已登录 · 打开用户菜单' : '打开用户菜单';
    $('authForm').hidden = signed() || !configured;
    $('signedIn').hidden = !signed();
    $('resetForm').hidden = true;
    $('signedEmail').textContent = user?.email || '';
    $('accountState').textContent = !configured ? '云同步尚未启用，本机记录仍可正常使用。' :
      user ? '同一邮箱账号可以在手机和电脑上同步手账。' : '登录后可同步手账；未登录时只保存在此设备。';
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(sync, 1000); }
  async function sync() {
    if (!engine || busy) return;
    if (!navigator.onLine) { status('离线 · 已保存到本机'); return; }
    const current = engine, ticket = generation;
    busy = true;
    status('正在同步');
    try {
      await current.sync();
      if (ticket !== generation) return;
      if (!editing()) { setData(store.data); refresh(); }
      status();
      if (store.pending && !Object.keys(store.state.conflicts).length) schedule();
    } catch (error) {
      if (ticket !== generation) return;
      status('已保存到本机 · 同步未完成');
      $('authMessage').textContent = `同步未完成：${error.message}。本机记录仍保留，可稍后重试。`;
    } finally { if (ticket === generation) busy = false; }
  }
  function guestChanged() {
    guest = structuredClone(getData());
    guestRaw = localStorage.getItem('time-journal-notebook-v2') || JSON.stringify(guest);
  }
  async function sessionChanged(session) {
    const next = session?.user || null;
    if (next?.id === user?.id) return;
    generation++;
    const ticket = generation;
    engine?.stop();
    clearTimeout(timer);
    busy = false;
    if (!user) guestChanged();
    user = next;
    store = null;
    engine = null;
    try {
      if (user) {
        store = new NotebookStore(localStorage, user.id);
        engine = new SyncEngine(store, journalApi(user.id), () => {
          if (!editing()) { setData(store.data); refresh(); }
        }, () => !editing());
        setData(store.data);
      } else setData(structuredClone(guest));
      refresh();
      accountView();
      status(user ? '正在同步' : '已保存到本机');
      await sync();
      if (ticket !== generation) return;
      if (user && Object.values(guest.days).some(meaningful) &&
          localStorage.getItem(`${store.key}:migration`) !== guestRaw) open('migrationDialog');
    } catch (error) {
      // An unreadable account cache must never fall back to guest data and upload it.
      document.querySelector('main').inert = true;
      report(error.message);
      $('authMessage').textContent = error.message;
      accountView();
    }
  }
  function preview(day) {
    const tasks = day.tasks.filter(t => t.text.trim()).map(t => `${t.done ? '✓' : '○'} ${t.text}`);
    const rows = key => day[key].filter(r => r.text || r.start || r.end)
      .map(r => `${r.start || '…'}–${r.end || '…'} ${r.text}`);
    return ['待办', ...tasks, '', '计划日程', ...rows('plans'), '', '实际日程', ...rows('actuals'), '', '备注', day.notes].join('\n');
  }
  function conflictView() {
    const date = store && Object.keys(store.state.conflicts).sort()[0];
    if (!date) { $('conflictDialog').close(); return; }
    $('conflictDate').textContent = date;
    $('localVersion').textContent = preview(store.state.days[date]);
    $('cloudVersion').textContent = preview(store.state.conflicts[date].content);
    open('conflictDialog');
  }
  function resolve(choice) {
    const date = $('conflictDate').textContent;
    try {
      store.resolve(date, choice);
      setData(store.data); refresh(); status(); conflictView(); schedule();
    } catch (error) { report(error.message); }
  }
  function download(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function authAction(action) {
    if (!client) return;
    const buttons = [...$('authForm').querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    $('authMessage').textContent = '';
    const email = $('email').value.trim(), password = $('password').value;
    const redirectTo = location.origin + location.pathname;
    try {
      if (!$('email').reportValidity()) return;
      if (action !== 'forgot' && !password) { $('password').reportValidity(); return; }
      if (action === 'signup' && password.length < 8) throw Error('注册密码至少需要 8 个字符。');
      const result = action === 'signup' ? await client.auth.signUp({ email, password,
        options: { emailRedirectTo: redirectTo } }) : action === 'forgot' ?
        await client.auth.resetPasswordForEmail(email, {
          redirectTo: new URL('./reset-password.html', location.href).href }) :
        await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      $('password').value = '';
      $('authMessage').textContent = action === 'signup' ?
        (result.data.session ? '注册成功，已登录。' : '请查看邮箱中的确认邮件，确认后即可登录。') :
        action === 'forgot' ? '如果该邮箱可接收重置邮件，请按邮件中的链接设置新密码。' : '登录成功。';
    } catch (error) { $('authMessage').textContent = error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  $('account').onclick = () => { accountView(); open('accountDialog'); };
  document.querySelectorAll('[data-close]').forEach(button => {
    button.onclick = () => $(button.dataset.close).close();
  });
  $('authForm').onsubmit = event => { event.preventDefault(); authAction('login'); };
  $('signup').onclick = () => authAction('signup');
  $('forgot').onclick = () => authAction('forgot');
  $('resetForm').onsubmit = async event => {
    event.preventDefault();
    const { error } = await client.auth.updateUser({ password: $('newPassword').value });
    $('authMessage').textContent = error ? error.message : '密码已更新。';
    if (!error) { $('newPassword').value = ''; accountView(); }
  };
  $('status').onclick = () => {
    if (Object.keys(store?.state.conflicts || {}).length) conflictView();
  };
  $('signout').onclick = async () => {
    await sync();
    if (store?.pending && !confirm('还有未同步或待选择版本的记录。退出后会保留在此设备的账号缓存中，下次登录此账号可继续同步。仍要退出？')) return;
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) $('authMessage').textContent = error.message;
  };
  $('migrateGuest').onclick = () => {
    try {
      store.importDays(guest);
      localStorage.setItem(`${store.key}:migration`, guestRaw || '');
      setData(store.data); refresh(); status(); $('migrationDialog').close();
      conflictView(); schedule();
    } catch (error) { report(error.message); }
  };
  $('skipMigration').onclick = () => $('migrationDialog').close();
  $('keepLocal').onclick = () => resolve('local');
  $('keepCloud').onclick = () => resolve('cloud');
  $('exportConflicts').onclick = () => download({ format: 'shijian-conflicts-v1', conflicts:
    JSON.parse(localStorage.getItem(`${store.key}:conflict-backups`) || '[]'),
    pending: store.state.conflicts, local: store.data }, '时笺-冲突备份.json');
  addEventListener('focusout', schedule);
  addEventListener('online', schedule);
  addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  addEventListener('storage', event => {
    if (store && event.key === store.key) {
      engine?.stop(); engine = null;
      document.querySelector('main').inert = true;
      report('另一个标签页修改了此账号的记录，请刷新后继续。');
      status('请刷新');
    }
  });
  setInterval(() => { if (!document.hidden) sync(); }, 15000);
  accountView();
  if (client) {
    client.auth.onAuthStateChange((event, session) => {
      // Supabase callbacks must not await additional auth API calls.
      queueMicrotask(async () => {
        await sessionChanged(session);
        if (event === 'PASSWORD_RECOVERY') {
          $('authForm').hidden = true; $('signedIn').hidden = true; $('resetForm').hidden = false;
          open('accountDialog');
        }
      });
    });
  }
  return {
    save(date, day) {
      if (!user) return false;
      if (!store) throw Error('账号记录尚未准备好。');
      store.edit(date, day); status(); schedule(); return true;
    },
    importData(incoming) {
      if (!store) return false;
      store.importDays(incoming); setData(store.data); refresh(); status(); conflictView(); schedule(); return true;
    },
    guestSaved() { if (!user) { guestChanged(); status(); } }
  };
}
