document.addEventListener('DOMContentLoaded', () => {
  // ==================== DOM 元素 ====================
  const enabledCheckbox = document.getElementById('enabled');
  const dateKeywordInput = document.getElementById('dateKeyword');
  const keywordInput = document.getElementById('keyword');
  const ticketCountSelect = document.getElementById('ticketCount');
  const disableAnimationCheckbox = document.getElementById('disableAnimation');
  const autoRefreshCheckbox = document.getElementById('autoRefresh');
  const refreshIntervalSelect = document.getElementById('refreshInterval');
  const refreshIntervalGroup = document.getElementById('refreshIntervalGroup');
  const saleTimeInput = document.getElementById('saleTime');
  const countdownDiv = document.getElementById('countdown');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const logToggle = document.getElementById('logToggle');
  const logPanel = document.getElementById('logPanel');
  const logContent = document.getElementById('logContent');
  const logArrow = document.getElementById('logArrow');

  // ==================== 載入設定 ====================
  const STORAGE_KEYS = [
    'enabled', 'dateKeyword', 'keyword', 'ticketCount',
    'disableAnimation', 'autoRefresh', 'refreshInterval', 'saleTime'
  ];

  chrome.storage.local.get(STORAGE_KEYS, (result) => {
    enabledCheckbox.checked = result.enabled !== false;         // 預設啟用
    dateKeywordInput.value = result.dateKeyword || '';
    keywordInput.value = result.keyword || '';
    ticketCountSelect.value = result.ticketCount || '2';
    disableAnimationCheckbox.checked = result.disableAnimation !== false; // 預設開啟
    autoRefreshCheckbox.checked = result.autoRefresh === true;           // 預設關閉
    refreshIntervalSelect.value = result.refreshInterval || '800';
    saleTimeInput.value = result.saleTime || '';

    // 顯示/隱藏重整間隔選項
    toggleRefreshIntervalUI();

    // 啟動倒數計時
    if (result.saleTime) {
      startCountdown(result.saleTime);
    }
  });

  // ==================== 重整間隔顯示切換 ====================
  function toggleRefreshIntervalUI() {
    refreshIntervalGroup.style.display = autoRefreshCheckbox.checked ? 'block' : 'none';
  }

  autoRefreshCheckbox.addEventListener('change', toggleRefreshIntervalUI);

  // ==================== 儲存設定 ====================
  saveBtn.addEventListener('click', () => {
    const settings = {
      enabled: enabledCheckbox.checked,
      dateKeyword: dateKeywordInput.value.trim(),
      keyword: keywordInput.value.trim(),
      ticketCount: ticketCountSelect.value,
      disableAnimation: disableAnimationCheckbox.checked,
      autoRefresh: autoRefreshCheckbox.checked,
      refreshInterval: refreshIntervalSelect.value,
      saleTime: saleTimeInput.value
    };

    chrome.storage.local.set(settings, () => {
      showNotification('✅ 設定已儲存！');
    });
  });

  // ==================== #8 即時狀態查詢 ====================
  function checkContentScriptStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) {
        setStatusIndicator('inactive', '無法取得分頁');
        return;
      }

      const url = tabs[0].url || '';
      if (!url.includes('tixcraft.com')) {
        setStatusIndicator('inactive', '目前不在拓元網站');
        return;
      }

      try {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            setStatusIndicator('warning', '等待頁面載入...');
            return;
          }

          const { status, phase, logs: remoteLogs } = response;

          // 狀態對照表
          const statusMap = {
            'active':          { state: 'active',  text: '🟢 運作中' },
            'waiting':         { state: 'warning', text: '🟡 待命中' },
            'waiting_captcha': { state: 'active',  text: '🎯 等待驗證碼' },
            'done':            { state: 'active',  text: '✅ 已完成' },
            'disabled':        { state: 'inactive', text: '⏸️ 已停用' },
            'timeout':         { state: 'warning', text: '⏱️ 已超時' },
            'error':           { state: 'error',   text: '❌ 錯誤' },
            'initializing':    { state: 'active',  text: '🔄 初始化...' }
          };

          const phaseMap = {
            'buyTicket':  '（購票頁）',
            'selectArea': '（選區頁）',
            'fillForm':   '（填表頁）',
            'idle':       '（待命）'
          };

          const info = statusMap[status] || { state: 'warning', text: '狀態: ' + status };
          setStatusIndicator(info.state, info.text + (phaseMap[phase] || ''));

          // #9 更新日誌面板
          if (remoteLogs && remoteLogs.length > 0) {
            logContent.innerHTML = remoteLogs.map(l =>
              `<div class="log-entry"><span class="log-time">${escapeHtml(l.time)}</span> ${escapeHtml(l.message)}</div>`
            ).join('');
            logContent.scrollTop = logContent.scrollHeight;
          }
        });
      } catch (e) {
        setStatusIndicator('warning', '通訊異常');
      }
    });
  }

  function setStatusIndicator(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
  }

  // 每秒查詢一次
  checkContentScriptStatus();
  const statusInterval = setInterval(checkContentScriptStatus, 1000);

  // Popup 關閉時清理（雖然 Chrome 會自動處理）
  window.addEventListener('unload', () => {
    clearInterval(statusInterval);
  });

  // ==================== #13 倒數計時器 ====================
  let countdownTimer = null;

  function startCountdown(saleTimeStr) {
    if (countdownTimer) clearInterval(countdownTimer);

    const saleTime = new Date(saleTimeStr).getTime();
    if (isNaN(saleTime)) {
      countdownDiv.textContent = '';
      countdownDiv.className = 'countdown';
      return;
    }

    function update() {
      const now = Date.now();
      const diff = saleTime - now;

      if (diff <= 0) {
        countdownDiv.textContent = '🔥 已開賣！快搶！';
        countdownDiv.className = 'countdown sale-live';
        clearInterval(countdownTimer);
        return;
      }

      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      let text = '⏰ 距離開賣：';
      if (days > 0) text += days + '天 ';
      text += hours + '時 ' + minutes + '分 ' + seconds + '秒';

      countdownDiv.textContent = text;
      countdownDiv.className = 'countdown';

      // 5 分鐘內加上緊張效果
      if (diff <= 300000) {
        countdownDiv.className = 'countdown countdown-urgent';
      }
    }

    update();
    countdownTimer = setInterval(update, 1000);
  }

  saleTimeInput.addEventListener('change', () => {
    if (saleTimeInput.value) {
      startCountdown(saleTimeInput.value);
    } else {
      countdownDiv.textContent = '';
      countdownDiv.className = 'countdown';
      if (countdownTimer) clearInterval(countdownTimer);
    }
  });

  // ==================== #9 日誌面板收合 ====================
  let logOpen = false;

  logToggle.addEventListener('click', () => {
    logOpen = !logOpen;
    logPanel.classList.toggle('open', logOpen);
    logArrow.textContent = logOpen ? '▲' : '▼';
  });

  // ==================== #10 設定匯出 ====================
  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(null, (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tixcraft_helper_settings.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification('📤 設定已匯出！');
    });
  });

  // ==================== #10 設定匯入 ====================
  importBtn.addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        chrome.storage.local.set(data, () => {
          showNotification('📥 設定已匯入！即將重新載入...');
          setTimeout(() => location.reload(), 1500);
        });
      } catch (err) {
        showNotification('❌ 匯入失敗：檔案格式錯誤');
      }
    };
    reader.readAsText(file);
    importFile.value = ''; // 重設，允許重複匯入同一個檔案
  });

  // ==================== 工具函式 ====================
  function showNotification(message) {
    statusDiv.textContent = message;
    statusDiv.classList.add('show');
    setTimeout(() => {
      statusDiv.classList.remove('show');
    }, 2500);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
