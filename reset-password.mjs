const authRedirectError = new URLSearchParams(location.hash.slice(1)).get('error_description');
const { client } = await import('./cloud.mjs');

const form = document.getElementById('passwordForm');
const message = document.getElementById('resetStatus');
const password = document.getElementById('newPassword');
const repeat = document.getElementById('repeatPassword');
const button = document.getElementById('savePassword');
let accountId;

try {
  if (!client || authRedirectError) throw Error('重置链接已失效或已使用，请返回时笺重新点击“忘记密码”。');
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw Error('无法确认重置账号，请从最新的密码重置邮件打开此页。');
  accountId = data.user.id;
  message.textContent = `为 ${data.user.email} 设置新密码（至少 8 位）。`;
  form.hidden = false;
} catch (error) { message.textContent = error.message; }

form.onsubmit = async event => {
  event.preventDefault();
  if (password.value !== repeat.value) {
    message.textContent = '两次输入的密码不一致。';
    return;
  }
  button.disabled = true;
  try {
    const current = await client.auth.getUser();
    if (current.error || current.data.user?.id !== accountId) throw Error('登录账号已变化，请重新打开密码重置邮件。');
    const { error } = await client.auth.updateUser({ password: password.value });
    if (error) throw error;
    form.reset();
    form.hidden = true;
    message.textContent = '密码已更新。请返回时笺；其他设备下次登录时使用新密码。';
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
};
