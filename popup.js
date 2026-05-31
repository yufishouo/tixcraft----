document.addEventListener('DOMContentLoaded', () => {
  const enabledCheckbox = document.getElementById('enabled');
  const dateKeywordInput = document.getElementById('dateKeyword');
  const keywordInput = document.getElementById('keyword');
  const ticketCountSelect = document.getElementById('ticketCount');
  
  const disableAnimationCheckbox = document.getElementById('disableAnimation');
  const autoRefreshCheckbox = document.getElementById('autoRefresh');
  
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');

  // 載入先前的設定
  chrome.storage.local.get(['enabled', 'dateKeyword', 'keyword', 'ticketCount', 'disableAnimation', 'autoRefresh'], (result) => {
    enabledCheckbox.checked = result.enabled !== false; // 預設為 true (啟用)
    dateKeywordInput.value = result.dateKeyword || '';
    keywordInput.value = result.keyword || '';
    ticketCountSelect.value = result.ticketCount || '2'; // 預設 2 張
    
    disableAnimationCheckbox.checked = result.disableAnimation !== false; // 預設開啟
    autoRefreshCheckbox.checked = result.autoRefresh === true; // 預設關閉
  });

  // 點擊儲存按鈕
  saveBtn.addEventListener('click', () => {
    const enabled = enabledCheckbox.checked;
    const dateKeyword = dateKeywordInput.value.trim();
    const keyword = keywordInput.value.trim();
    const ticketCount = ticketCountSelect.value;
    const disableAnimation = disableAnimationCheckbox.checked;
    const autoRefresh = autoRefreshCheckbox.checked;

    chrome.storage.local.set({ 
      enabled, dateKeyword, keyword, ticketCount, 
      disableAnimation, autoRefresh 
    }, () => {
      statusDiv.textContent = '設定已儲存！';
      statusDiv.classList.add('show');
      setTimeout(() => {
        statusDiv.classList.remove('show');
      }, 2000);
    });
  });
});
