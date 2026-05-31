chrome.storage.local.get([
  'enabled', 'dateKeyword', 'keyword', 'ticketCount',
  'disableAnimation', 'autoRefresh'
], (config) => {
  if (config.enabled === false) return; // 如果沒有啟用，直接結束

  const disableAnimation = config.disableAnimation !== false; // 預設開啟
  const autoRefresh = config.autoRefresh === true;

  if (disableAnimation) {
    const style = document.createElement('style');
    style.textContent = `
      * {
        transition: none !important;
        animation: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    console.log("🚀 [大佬模式] 已拔除所有網頁過場動畫");
  }

  /**
   * 大佬級優化：注入 Script 到主頁面以攔截惱人的 window.alert 和 window.confirm
   * 避免系統跳出「請勿重新整理」之類的彈出視窗卡死搶票流程。
   * (將此功能移入 enabled 判斷內，尊重使用者的開關設定)
   */
  function injectAntiAlert() {
    const script = document.createElement('script');
    script.textContent = `
      window.alert = function(msg) { console.log('已攔截 Alert:', msg); };
      window.confirm = function(msg) { console.log('已攔截 Confirm:', msg); return true; };
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }
  injectAntiAlert();

  const dateKeyword = config.dateKeyword ? config.dateKeyword.trim().toLowerCase() : '';
  const keyword = config.keyword ? config.keyword.trim().toLowerCase() : '';
  const ticketCount = config.ticketCount || '2';

  const path = window.location.pathname;

  console.log("拓元搶票輔助 啟動中...", path);

  // 1. 活動詳情頁面 or 場次列表頁面
  if (path.includes('/activity/detail/') || path.includes('/activity/game/')) {
    autoClickBuyTicket(dateKeyword, autoRefresh);
  } 
  // 2. 區域選擇頁面
  else if (path.includes('/ticket/area/')) {
    autoSelectArea(keyword, ticketCount);
  }
  // 3. 張數與驗證碼頁面
  else if (path.includes('/ticket/ticket/')) {
    autoFillTicketForm(ticketCount);
  }
});

/**
 * 1. 極速檢查「立即購票」或「立即訂購」按鈕是否存在且可點擊
 */
function autoClickBuyTicket(dateKeyword, autoRefresh) {
  let refreshTimer = null;
  // 大佬優化：使用 requestAnimationFrame 替代 setInterval，達到 0 毫秒延遲的極限輪詢
  function check() {
    const buyButtons = document.querySelectorAll('.btn-primary, button, a.btn');
    for (const btn of buyButtons) {
      const text = btn.textContent.trim().toLowerCase();
        // 檢查按鈕是否被禁用 (包含 button 的 disabled 屬性與 a 標籤的 disabled class)
        const isDisabled = btn.disabled || btn.classList.contains('disabled');
        // 支援多國語言 (立即購票、立即訂購、訂購、buy、order)
        const isBuyButton = /立即購票|立即訂購|訂購|buy|order/.test(text);
        
        if (isBuyButton && !isDisabled) {
        
        // 如果有設定場次關鍵字，檢查按鈕所在的列或父容器是否包含該關鍵字
        if (dateKeyword) {
          const dateKeywords = dateKeyword.split(/\s+/).filter(k => k);
          let parent = btn.parentElement;
          let foundKeyword = false;
          let depth = 0;
          let textForCheck = '';
          // 往上找最多 5 層父節點 (通常 table 的 tr 是第 2 或第 3 層)
          while (parent && depth < 5) {
            textForCheck = parent.textContent.toLowerCase();
            if (dateKeywords.every(k => textForCheck.includes(k))) {
              foundKeyword = true;
              break;
            }
            parent = parent.parentElement;
            depth++;
          }
          if (!foundKeyword) {
            continue; // 這顆按鈕不符合場次，繼續找下一個
          }
        }

        console.log("🔥 [大佬模式] 找到購票按鈕，光速點擊！", text);
        if (refreshTimer) clearTimeout(refreshTimer);
        btn.click();
        return; // 點擊後結束輪詢
      }
    }
    
    // 如果找不到有效按鈕，且開啟自動重整功能，則設定一個 800ms 後重整的計時器
    if (autoRefresh && !refreshTimer) {
      refreshTimer = setTimeout(() => {
        console.log("🚀 [大佬模式] 尚未開賣或無按鈕，自動重新整理...");
        location.reload();
      }, 800);
    }

    requestAnimationFrame(check); // 沒找到就等下一幀繼續找
  }
  requestAnimationFrame(check);
}

/**
 * 2. 根據設定的關鍵字極速尋找區域並點擊
 */
function autoSelectArea(keyword, ticketCount) {
  const desired = parseInt(ticketCount, 10) || 1;

  function hasEnoughTickets(fullText) {
    // 支援中英文的剩餘張數檢查
    let match = fullText.match(/剩餘\s*(\d+)\s*張|remaining\s*(\d+)/i);
    if (match) {
      let remaining = parseInt(match[1] || match[2], 10);
      return remaining >= desired;
    }
    return true; // 沒寫剩餘幾張 (例如熱賣中)，當作數量足夠
  }

  function check() {
    // 擴大選取範圍：有些時候「剩餘幾張」的 DOM 結構會改變，所以多加幾個選擇器
    const allLinks = document.querySelectorAll('.zone-area a, .area-list a, a[href*="/ticket/ticket/"]');
    
    // 大佬優化：第一層防護網，直接過濾掉「明確寫著已售完」的區域
    const validAreaLinks = Array.from(allLinks).filter(link => {
      let parent = link;
      let depth = 0;
      let text = '';
      while (parent && depth < 3) {
        text += parent.textContent.toLowerCase() + ' ';
        parent = parent.parentElement;
        depth++;
      }
      return !text.includes("已售完") && !text.includes("售罄") && !text.includes("sold out");
    });

    if (validAreaLinks.length === 0) {
      // 網頁還沒載入完畢，或是真的全部賣光了，繼續等
      requestAnimationFrame(check); 
      return;
    }

    if (keyword) {
      for (const link of validAreaLinks) {
        // 檢查連結本身，或它的父層元素（例如整個 li 或 div）是否包含關鍵字
        // 解決「剩餘幾張」時，關鍵字與連結被拆分到不同標籤的問題
        // 支援多組關鍵字（用空白分隔），且轉小寫比對
        const keywords = keyword.split(/\s+/).filter(k => k);
        let parent = link;
        let foundKeyword = false;
        let depth = 0;
        let textForCheck = '';
        
        while (parent && depth < 3) {
          textForCheck = parent.textContent.toLowerCase();
          // 必須包含「所有」關鍵字才算符合
          if (keywords.every(k => textForCheck.includes(k))) {
            foundKeyword = true;
            break;
          }
          parent = parent.parentElement;
          depth++;
        }

        if (foundKeyword) {
          if (hasEnoughTickets(textForCheck)) {
            console.log("🔥 [大佬模式] 找到符合關鍵字且張數足夠的區域：", link.textContent);
            link.click();
            return;
          } else {
            console.log("⚠️ [大佬模式] 找到關鍵字區域，但張數不足，跳過：", link.textContent);
          }
        }
      }
      console.log("找不到關鍵字「" + keyword + "」且張數足夠的區域，已停止自動選擇，請手動點擊。");
      // 找不到就不再輪詢，交給人類
    } else {
      // 沒有填關鍵字：從上往下找「張數足夠」的第一個區域
      for (const link of validAreaLinks) {
        let parent = link;
        let depth = 0;
        let textForCheck = '';
        while (parent && depth < 3) {
          textForCheck += parent.textContent.toLowerCase() + ' ';
          parent = parent.parentElement;
          depth++;
        }

        if (hasEnoughTickets(textForCheck)) {
          console.log("🔥 [大佬模式] 未設定關鍵字，盲狙第一個張數足夠的可用區域！");
          link.click();
          return;
        }
      }
      
      // 如果全部都張數不夠，為了避免完全買不到，還是將就盲狙第一個可用區域 (且已經排除已售完)
      console.log("🔥 [大佬模式] 所有可用區域的張數都不夠，將就盲狙第一個還有票的區域！");
      validAreaLinks[0].click();
      return;
    }
  }
  requestAnimationFrame(check);
}

/**
 * 3. 閃電填寫購票表單
 */
function autoFillTicketForm(ticketCount) {
  let formFilled = false;
  
  function check() {
    if (formFilled) return;

    // 1. 自動選擇張數
    const selects = document.querySelectorAll('select');
    let targetSelect = null;
    
    for (const s of selects) {
      if (s.id.includes('TicketForm') || s.classList.contains('mobile-select')) {
        targetSelect = s;
        break;
      }
    }

    if (targetSelect && targetSelect.value === "0") {
      let targetValue = ticketCount;
      let optionExists = Array.from(targetSelect.options).some(opt => opt.value === targetValue);
      
      if (!optionExists) {
        let maxAvailable = 0;
        for (const opt of targetSelect.options) {
          if (opt.value !== "0" && opt.value !== "") {
            maxAvailable = Math.max(maxAvailable, parseInt(opt.value, 10));
          }
        }
        targetValue = maxAvailable.toString();
      }
      
      if (targetValue !== "0" && targetValue !== "NaN") {
        targetSelect.value = targetValue;
        // 大佬優化：同時觸發 input 和 change 事件，確保前端框架有吃到狀態
        targetSelect.dispatchEvent(new Event('input', { bubbles: true }));
        targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`🔥 [大佬模式] 鎖定張數：${targetValue}`);
      }
    }

    // 2. 自動勾選「我同意」條款
    const agreeCheckbox = document.getElementById('TicketForm_agree');
    if (agreeCheckbox && !agreeCheckbox.checked) {
      // 大佬優化：用 click() 模擬真實點擊，比直接改 .checked 更安全，不容易被擋
      agreeCheckbox.click();
      console.log("🔥 [大佬模式] 已勾選同意條款。");
    }

    // 3. 自動將滑鼠游標鎖定在「驗證碼輸入框」並滾動到畫面中央
    const captchaInput = document.getElementById('TicketForm_verifyCode');
    if (captchaInput) {
      if (document.activeElement !== captchaInput) {
        // 大佬優化：將驗證碼滾動到畫面正中央，並強制 Focus
        captchaInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        captchaInput.focus();
        console.log("🎯 [大佬模式] 驗證碼框已鎖定，就等您的神手速！");
      }
    }
    
    // 大佬優化：防呆機制，避免因為網頁缺少下拉選單或同意核取方塊而陷入死迴圈
    const isSelectOk = targetSelect ? (targetSelect.value !== "0" && targetSelect.value !== "") : true;
    const isAgreeOk = agreeCheckbox ? agreeCheckbox.checked : true;
    const isCaptchaOk = captchaInput ? (document.activeElement === captchaInput) : true;
    
    if (isSelectOk && isAgreeOk && isCaptchaOk) {
      formFilled = true; // 狀態都對了才停止輪詢
    }
    
    if (!formFilled) {
      requestAnimationFrame(check); // 繼續輪詢
    }
  }
  requestAnimationFrame(check);
}
