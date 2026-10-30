import { createClient } from './supabase-vendor.mjs';
import { cloudConfig } from './config.mjs';

export const configured = !!(cloudConfig.url && cloudConfig.publishableKey);
if (configured && cloudConfig.publishableKey.startsWith('sb_secret_')) {
  throw Error('浏览器配置中禁止使用服务端密钥。');
}
export const client = configured ? createClient(cloudConfig.url, cloudConfig.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'shijian-login-v1' }
}) : null;

export function journalApi(userId) {
  const table = () => client.from('journal_days').select('day, content, revision').eq('user_id', userId);
  return {
    async list() {
      const rows = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await table().order('day').range(offset, offset + 499);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) return rows;
      }
    },
    async get(date) {
      const { data, error } = await table().eq('day', date).maybeSingle();
      if (error) throw error;
      return data;
    },
    async save(date, content, revision) {
      const { data, error } = await client.rpc('save_journal_day', {
        p_day: date, p_content: content, p_expected_revision: revision
      });
      if (error) throw error;
      return Number(data);
    }
  };
}
