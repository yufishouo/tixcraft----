/**
 * content.js — 拓元搶票輔助 v1.2
 *
 * 功能：
 * - 自動點擊購票按鈕（含多組場次關鍵字備選）
 * - 自動選擇區域（含多組票價關鍵字備選）
 * - 自動填寫表單（張數、同意條款、驗證碼聚焦）
 * - 驗證碼 Enter 自動提交
 * - 驗證碼圖片放大
 * - 全域錯誤捕捉 & 超時保護
 * - 日誌系統 + Popup 狀態通訊
 */

(function () {
  'use strict';

  // ==================== 全域常數 ====================
  const MAX_WAIT_MS = 30000; // 每階段最大等待 30 秒
  const RETRY_KEYWORD_MS = 3000; // 關鍵字張數不足重試時間
  const POLL_MS = 50; // 輪詢間隔。改用 setTimeout 而非 requestAnimationFrame，
                      // 因為 rAF 在背景分頁會被完全暫停，導致多開分頁時搶票邏輯停擺。

  // ==================== 全域狀態 ====================
  const logs = [];
  let currentStatus = 'initializing'; // initializing | active | waiting | waiting_captcha | done | disabled | timeout | error
  let currentPhase = '';              // buyTicket | selectArea | fillForm | idle

  // ==================== 日誌系統 ====================
  function log(message) {
    const entry = {
      time: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
      message
    };
    logs.push(entry);
    if (logs.length > 100) logs.shift(); // 保留最近 100 條
    console.log(message);

    // 嘗試即時推送給 popup（popup 未開啟時會靜默失敗）
    try {
      chrome.runtime.sendMessage({ type: 'NEW_LOG', entry }).catch(() => {});
    } catch (e) { /* ignored */ }
  }

  // ==================== 訊息監聽器（供 Popup 查詢狀態）====================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_STATUS') {
      sendResponse({
        status: currentStatus,
        phase: currentPhase,
        url: window.location.href,
        logs: logs.slice(-50) // 回傳最近 50 條
      });
      return true; // 保持 sendResponse channel 開啟
    }
  });

  // ==================== 主程式入口 ====================
  try {
    chrome.storage.local.get([
      'enabled', 'dateKeyword', 'keyword', 'ticketCount',
      'disableAnimation', 'autoRefresh', 'refreshInterval', 'saleTime'
    ], (config) => {
      try {
        // 未啟用 → 直接結束
        if (config.enabled === false) {
          currentStatus = 'disabled';
          log('⏸️ 輔助功能已關閉');
          return;
        }

        currentStatus = 'active';
        const disableAnimation = config.disableAnimation !== false; // 預設開啟
        const autoRefresh = config.autoRefresh === true;            // 預設關閉
        const refreshInterval = parseInt(config.refreshInterval) || 800;

        // ---- 移除網頁動畫 ----
        if (disableAnimation) {
          const style = document.createElement('style');
          style.textContent = `
            *, *::before, *::after {
              transition: none !important;
              animation: none !important;
            }
          `;
          (document.head || document.documentElement).appendChild(style);
          log('🚀 已拔除所有網頁過場動畫');
        }

        // ---- 解析設定 ----
        const dateKeyword = config.dateKeyword ? config.dateKeyword.trim().toLowerCase() : '';
        const keyword = config.keyword ? config.keyword.trim().toLowerCase() : '';
        const ticketCount = config.ticketCount || '2';
        const path = window.location.pathname;

        log('⚡ 拓元搶票輔助 v1.2 啟動！ → ' + path);

        // ---- 路由判斷 ----
        if (path.includes('/activity/detail/') || path.includes('/activity/game/')) {
          currentPhase = 'buyTicket';
          log('📍 偵測到：活動/場次頁面');
          autoClickBuyTicket(dateKeyword, autoRefresh, refreshInterval);
        }
        else if (path.includes('/ticket/area/')) {
          currentPhase = 'selectArea';
          log('📍 偵測到：區域選擇頁面');
          autoSelectArea(keyword, ticketCount);
        }
        else if (path.includes('/ticket/ticket/')) {
          currentPhase = 'fillForm';
          log('📍 偵測到：張數/驗證碼頁面');
          // 有些特殊活動（或無劃位活動），「區域選擇」會和「張數選擇」合併在同一個頁面
          // 同時啟動選區和填表，確保不管在哪種版面都能一步到位
          autoSelectArea(keyword, ticketCount, true);
          autoFillTicketForm(ticketCount);
        }
        else {
          currentPhase = 'idle';
          currentStatus = 'waiting';
          log('📍 目前頁面不需要自動操作，待命中');
        }

      } catch (error) {
        currentStatus = 'error';
        log('🚨 執行階段錯誤: ' + error.message);
        console.error(error);
      }
    });
  } catch (error) {
    currentStatus = 'error';
    log('🚨 初始化錯誤: ' + error.message);
    console.error(error);
  }

  // ====================================================================
  //  1. 自動點擊購票按鈕
  //     支援：多組場次關鍵字備選、智慧重整間隔、超時保護
  // ====================================================================
  function autoClickBuyTicket(dateKeywordRaw, autoRefresh, refreshInterval) {
    let refreshTimer = null;
    let clicked = false;
    const startTime = Date.now();

    // #4 多組場次關鍵字備選（逗號 or 中文逗號分隔）
    const dateKeywordGroups = dateKeywordRaw
      ? dateKeywordRaw.split(/[,，]/).map(g => g.trim()).filter(g => g)
      : [];

    if (dateKeywordGroups.length > 0) {
      log('🎯 場次關鍵字：' + dateKeywordGroups.map((g, i) => `[${i + 1}] ${g}`).join(' → '));
    }

    function check() {
      if (clicked) return;

      // #6 超時保護
      if (Date.now() - startTime > MAX_WAIT_MS) {
        currentStatus = 'timeout';
        log('⏱️ 購票按鈕搜尋超過 30 秒，停止輪詢。請手動操作。');
        return;
      }

      const buyButtons = document.querySelectorAll('.btn-primary, button, a.btn');

      for (const btn of buyButtons) {
        const text = btn.textContent.trim().toLowerCase();
        const isDisabled = btn.disabled || btn.classList.contains('disabled');
        const isBuyButton = /立即購票|立即訂購|訂購|buy|order/.test(text);

        if (isBuyButton && !isDisabled) {

          // ---- 場次關鍵字篩選 ----
          if (dateKeywordGroups.length > 0) {
            let matchedAnyGroup = false;

            // 優先以「單一場次列」(<li>/<tr>) 為比對範圍，避免透過共用的 table/ul
            // 容器把隔壁場次的日期也一起讀進來，導致點到錯誤場次的購票鈕。
            const row = btn.closest('li, tr');

            for (const groupStr of dateKeywordGroups) {
              const keywords = groupStr.split(/\s+/).filter(k => k);
              let found = false;

              if (row) {
                const rowText = row.textContent.toLowerCase().replace(/,/g, '');
                found = keywords.every(k => rowText.includes(k.replace(/,/g, '')));
              } else {
                // 找不到列容器時，才退回有限度（3 層）的向上查找
                let parent = btn.parentElement;
                let depth = 0;
                while (parent && depth < 3) {
                  const parentText = parent.textContent.toLowerCase().replace(/,/g, '');
                  if (keywords.every(k => parentText.includes(k.replace(/,/g, '')))) {
                    found = true;
                    break;
                  }
                  parent = parent.parentElement;
                  depth++;
                }
              }

              if (found) {
                matchedAnyGroup = true;
                log('✅ 命中場次關鍵字：「' + groupStr + '」');
                break;
              }
            }

            if (!matchedAnyGroup) {
              continue; // 不符合任何場次關鍵字，找下一個按鈕
            }
          }

          // ---- 點擊按鈕 ----
          log('🔥 找到購票按鈕，光速點擊！ → ' + text);
          clicked = true;
          currentStatus = 'done';
          if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
          }
          btn.click();
          return;
        }
      }

      // ---- #3 智慧重整（含隨機抖動 ±150ms）----
      if (autoRefresh && !refreshTimer && !clicked) {
        const jitter = Math.floor(Math.random() * 300) - 150;
        const interval = Math.max(300, refreshInterval + jitter);
        refreshTimer = setTimeout(() => {
          if (clicked) return;
          log('🔄 自動重整中... (間隔 ' + interval + 'ms)');
          location.reload();
        }, interval);
      }

      setTimeout(check, POLL_MS);
    }

    setTimeout(check, POLL_MS);
  }

  // ====================================================================
  //  2. 自動選擇區域
  //     支援：多組票價關鍵字備選、張數不足重試、超時保護
  // ====================================================================
  function autoSelectArea(keywordRaw, ticketCount, isFormPage) {
    const desired = parseInt(ticketCount, 10) || 1;
    const startTime = Date.now();
    let retryStart = null;

    // 在填表頁，本函式僅為輔助（處理選區/填表合併的版面）；
    // 狀態以表單填寫流程為準，這裡不覆蓋 timeout，避免蓋掉「等待驗證碼」等狀態。
    const setStatus = (s) => { if (!isFormPage) currentStatus = s; };

    // #2 多組票價關鍵字備選（逗號分隔）
    const keywordGroups = keywordRaw
      ? keywordRaw.split(/[,，]/).map(g => g.trim()).filter(g => g)
      : [];

    if (keywordGroups.length > 0) {
      log('🎯 票價關鍵字：' + keywordGroups.map((g, i) => `[${i + 1}] ${g}`).join(' → '));
    }

    // 取得單一區域的容器元素，極度精準防護，絕對不往上找到 <ul> 或整個區塊的 div
    function getAreaContainer(link) {
      // 優先找最常見的單一項目容器 <li> 或 <tr>
      const liOrTr = link.closest('li, tr');
      if (liOrTr) return liOrTr;

      // 退一步：只往上找一層
      const parent = link.parentElement;
      if (parent) {
        // 如果父節點是列表容器，絕對不能用，否則會把其他區域的「已售完」讀進來
        const badTags = ['UL', 'OL', 'TBODY', 'TABLE'];
        if (badTags.includes(parent.tagName)) return link;
        
        // 如果父節點的 class 包含 list 等字眼，且不是 item，也不要用
        if (parent.className && typeof parent.className === 'string') {
          if ((parent.className.includes('list') || parent.className.includes('zone-area')) && !parent.className.includes('item')) {
            return link;
          }
        }
        return parent;
      }
      return link;
    }

    // 剩餘票數檢查（增強版正則，支援「剩餘 24」無「張」字的情況）
    function hasEnoughTickets(fullText) {
      const match = fullText.match(/剩餘[：:]?\s*(\d+)\s*張?|remaining[:\s]*(\d+)/i);
      if (match) {
        const remaining = parseInt(match[1] || match[2], 10);
        return remaining >= desired;
      }
      return true; // 沒寫剩餘幾張，當作數量足夠
    }

    function check() {
      // #6 超時保護
      if (Date.now() - startTime > MAX_WAIT_MS) {
        setStatus('timeout');
        log('⏱️ 區域搜尋超過 30 秒，停止輪詢。請手動操作。');
        return;
      }

      // 擴大選取範圍以支援各種版面。
      // 注意：填表頁(/ticket/ticket/)不使用寬鬆的 href 比對，否則會誤點麵包屑/返回等
      // 連結而把使用者導離正在填寫的表單。
      const areaSelectors = isFormPage
        ? '.zone-area a, .area-list a, ul.area-list > li > a, .select_form_a a, .select_form_b a'
        : '.zone-area a, .area-list a, a[href*="/ticket/ticket/"], ul.area-list > li > a, .select_form_a a, .select_form_b a';
      const allLinks = document.querySelectorAll(areaSelectors);

      // 第一層過濾：排除「已售完」的區域，以及指向目前頁面本身的連結
      const validAreaLinks = Array.from(allLinks).filter(link => {
        if (!link.href || link.href === window.location.href) return false; // 避免點到自己把頁面導走
        const container = getAreaContainer(link);
        const text = container.textContent.toLowerCase();
        if (text.includes('已售完') || text.includes('售罄') || text.includes('sold out')) {
          return false;
        }
        return true;
      });

      if (validAreaLinks.length === 0) {
        setTimeout(check, POLL_MS); // 網頁還沒載入完畢
        return;
      }

      // ---- 有設定關鍵字：按優先順序嘗試 ----
      if (keywordGroups.length > 0) {
        let anyKeywordFoundButInsufficient = false;
        let anyKeywordMatched = false;

        for (const groupStr of keywordGroups) {
          const keywords = groupStr.split(/\s+/).filter(k => k);

          for (const link of validAreaLinks) {
            const container = getAreaContainer(link);
            const textForCheck = container.textContent.toLowerCase();
            const normalizedText = textForCheck.replace(/,/g, '');

            let foundKeyword = false;
            if (keywords.every(k => normalizedText.includes(k.replace(/,/g, '')))) {
              foundKeyword = true;
            }

            if (foundKeyword) {
              anyKeywordMatched = true;
              if (hasEnoughTickets(textForCheck)) {
                log('🔥 命中關鍵字「' + groupStr + '」且張數足夠，點擊！');
                setStatus('done');
                link.click();
                return;
              } else {
                anyKeywordFoundButInsufficient = true;
                log('⚠️ 關鍵字「' + groupStr + '」區域張數不足，嘗試下一組');
              }
            }
          }
        }

        // 關鍵字命中但張數不足，或目標區域可能尚未渲染出來 → 在重試窗口內持續等待，
        // 不要在第一個輪詢就放棄（頁面常常是分批載入的）。
        if (anyKeywordFoundButInsufficient || !anyKeywordMatched) {
          if (!retryStart) retryStart = Date.now();
          if (Date.now() - retryStart < RETRY_KEYWORD_MS) {
            log(anyKeywordFoundButInsufficient
              ? '⏳ 關鍵字區域張數不足，持續重試中...'
              : '⏳ 尚未出現符合關鍵字的區域，持續重試中...');
            setTimeout(check, POLL_MS);
            return;
          }
          log(anyKeywordFoundButInsufficient
            ? '⏱️ 重試超過 3 秒，所有關鍵字組張數都不足，停止自動選擇。'
            : '❌ 重試超過 3 秒，找不到任何關鍵字的區域，停止自動選擇。請手動操作。');
          setStatus('timeout');
        }

      // ---- 沒有關鍵字：盲狙第一個可用區域 ----
      } else {
        for (const link of validAreaLinks) {
          const container = getAreaContainer(link);
          const textForCheck = container.textContent.toLowerCase();

          if (hasEnoughTickets(textForCheck)) {
            log('🔥 未設定關鍵字，盲狙第一個張數足夠的可用區域！');
            setStatus('done');
            link.click();
            return;
          }
        }

        // 全部張數不夠 → 將就盲狙
        log('🔥 所有區域張數都不夠，將就盲狙第一個還有票的區域！');
        setStatus('done');
        validAreaLinks[0].click();
        return;
      }
    }

    setTimeout(check, POLL_MS);
  }

  // ====================================================================
  //  3. 自動填寫購票表單
  //     支援：自動選張數、勾同意、聚焦驗證碼、Enter 自動提交、驗證碼放大
  // ====================================================================
  function autoFillTicketForm(ticketCount) {
    let formFilled = false;
    let captchaEverFocused = false;
    const startTime = Date.now();

    function check() {
      if (formFilled) return;

      // #6 超時保護
      if (Date.now() - startTime > MAX_WAIT_MS) {
        currentStatus = 'timeout';
        log('⏱️ 表單填寫超過 30 秒，停止輪詢。');
        return;
      }

      // ---- 1. 自動選擇張數 ----
      const selects = document.querySelectorAll('select');
      let targetSelect = null;
      for (const s of selects) {
        if (s.id.includes('TicketForm') || s.classList.contains('mobile-select')) {
          targetSelect = s;
          break;
        }
      }

      if (targetSelect && targetSelect.value === '0') {
        let targetValue = ticketCount;
        const optionExists = Array.from(targetSelect.options).some(opt => opt.value === targetValue);

        if (!optionExists) {
          let maxAvailable = 0;
          for (const opt of targetSelect.options) {
            if (opt.value !== '0' && opt.value !== '') {
              maxAvailable = Math.max(maxAvailable, parseInt(opt.value, 10));
            }
          }
          targetValue = maxAvailable.toString();
        }

        if (targetValue !== '0' && targetValue !== 'NaN') {
          targetSelect.value = targetValue;
          targetSelect.dispatchEvent(new Event('input', { bubbles: true }));
          targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
          log('🔥 鎖定張數：' + targetValue);
        }
      }

      // ---- 2. 自動勾選同意條款 ----
      const agreeCheckbox = document.getElementById('TicketForm_agree');
      if (agreeCheckbox && !agreeCheckbox.checked) {
        agreeCheckbox.click();
        log('🔥 已勾選同意條款');
      }

      // ---- 3. 聚焦驗證碼輸入框 ----
      // 只在「還沒成功聚焦過」時主動搶焦點：避免每次輪詢都把使用者正在打字的焦點搶走，
      // 也避免使用者點別處後 isCaptchaOk 永遠為 false、表單完成狀態卡住。
      const captchaInput = document.getElementById('TicketForm_verifyCode');
      if (captchaInput) {
        if (!captchaEverFocused) {
          if (document.activeElement !== captchaInput) {
            captchaInput.scrollIntoView({ behavior: 'instant', block: 'center' });
            captchaInput.focus();
          }
          if (document.activeElement === captchaInput) {
            captchaEverFocused = true;
            log('🎯 驗證碼框已鎖定');
          }
        }

        // #1 自動提交：監聽 Enter 鍵（只綁一次）
        if (!captchaInput._autoSubmitBound) {
          captchaInput._autoSubmitBound = true;
          captchaInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const submitBtn = document.querySelector(
                'button[type="submit"], input[type="submit"], .btn-primary, #submitButton, button.btn'
              );
              if (submitBtn && !submitBtn.disabled) {
                submitBtn.click();
                log('🚀 驗證碼已輸入，自動提交表單！');
                currentStatus = 'done';
              }
            }
          });
          log('⌨️ 已綁定 Enter 鍵自動提交');
        }
      }

      // ---- #15 驗證碼圖片放大 ----
      const captchaImg = document.querySelector(
        '#TicketForm_verifyCode-image, .captcha-img, img[src*="captcha"], img[src*="verify"]'
      );
      if (captchaImg && !captchaImg._enlarged) {
        captchaImg._enlarged = true;
        captchaImg.style.transform = 'scale(1.5)';
        captchaImg.style.transformOrigin = 'left center';
        captchaImg.style.imageRendering = 'crisp-edges';
        captchaImg.style.position = 'relative';
        captchaImg.style.zIndex = '100';
        log('🔍 驗證碼圖片已放大 1.5 倍');
      }

      // ---- 完成度檢查 ----
      const isSelectOk = targetSelect ? (targetSelect.value !== '0' && targetSelect.value !== '') : true;
      const isAgreeOk = agreeCheckbox ? agreeCheckbox.checked : true;
      const isCaptchaOk = captchaInput ? captchaEverFocused : true;

      if (isSelectOk && isAgreeOk && isCaptchaOk) {
        formFilled = true;
        currentStatus = 'waiting_captcha';
        log('✅ 表單已自動填好！請輸入驗證碼後按 Enter 即可送出');
      }

      if (!formFilled) {
        setTimeout(check, POLL_MS);
      }
    }

    setTimeout(check, POLL_MS);
  }

})();
