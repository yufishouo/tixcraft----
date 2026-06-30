/**
 * anti_alert.js — 在 MAIN world 執行，攔截 alert / confirm 彈窗
 * 
 * 透過 manifest.json 的 "world": "MAIN" 設定，此腳本直接在頁面的主執行環境中運行，
 * 不受 Content Security Policy (CSP) 限制。
 * 
 * 攔截的原因：拓元售票系統會在搶票過程中跳出「請勿重新整理」等 alert/confirm 彈窗，
 * 這些彈窗會卡住自動化流程，必須攔截。
 */

(function () {
  'use strict';

  // 保留原始函式的參考，以備需要時恢復
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;

  window.alert = function (msg) {
    console.log('[搶票輔助] 已攔截 Alert:', msg);
    // 將錯誤訊息存入 sessionStorage，讓 content.js 知道發生了什麼事（例如「座位不連續」）
    if (msg && typeof msg === 'string') {
      try {
        sessionStorage.setItem('tix_last_alert', msg);
        sessionStorage.setItem('tix_last_alert_time', Date.now().toString());
      } catch (e) {}
    }
  };

  window.confirm = function (msg) {
    console.log('[搶票輔助] 已攔截 Confirm:', msg);
    // 同樣記錄下來
    if (msg && typeof msg === 'string') {
      try {
        sessionStorage.setItem('tix_last_alert', msg);
        sessionStorage.setItem('tix_last_alert_time', Date.now().toString());
      } catch (e) {}
    }
    return true; // 永遠回傳 true（同意）
  };
})();
