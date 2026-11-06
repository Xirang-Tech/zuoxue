export async function setupPreview(api, getPlanId) {
  const info = await api('/__preview/state');
  const bar = document.querySelector('#preview-controls');
  bar.hidden = false;
  const select = document.querySelector('#preview-scenario');
  for (const [value, title] of info.scenarios) { const option = document.createElement('option'); option.value = value; option.textContent = title; select.append(option); }
  select.value = info.scenario;
  const error = document.querySelector('#preview-error');
  const reloadAtTop = () => location.replace(location.pathname + location.search);
  async function action(action, planId) {
    error.textContent = '';
    try { await api('/__preview/action', { action, planId: planId || getPlanId() }); reloadAtTop(); }
    catch (failure) { error.textContent = failure.message; }
  }
  select.addEventListener('change', async () => {
    select.disabled = true;
    try { await api('/__preview/scenario', { scenario: select.value, planId: getPlanId() }); reloadAtTop(); }
    catch (failure) { error.textContent = failure.message; select.disabled = false; }
  });
  const actions = {
    activating: [['完成五款开通', 'complete'], ['模拟部分开通异常', 'fail']],
    partial: [['模拟重试成功', 'retry']],
    restoring: [['模拟恢复完成', 'restore']],
    refunded: [['模拟恢复完成', 'restore']],
    refunding: [['模拟退款到账', 'refund']],
  };
  const buttons = document.querySelector('#preview-actions');
  for (const [label, value] of actions[info.scenario] || []) {
    const button = document.createElement('button'); button.className = 'button outline small'; button.textContent = label;
    button.addEventListener('click', () => { button.disabled = true; void action(value); }); buttons.append(button);
  }
  return { ...info, action };
}
