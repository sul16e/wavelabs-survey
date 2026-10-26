// ==UserScript==
// @name         웨이브랩스 주차 4
// @namespace    wavelabs
// @version      4.0.0
// @description  나이스파크 웹할인 화면에 웨이브랩스 셀프 주차 화면을 얹는다(본체 core.js를 매번 새로 불러옴)
// @match        https://npdc-i.nicepark.co.kr/*
// @run-at       document-end
// @inject-into  page
// @updateURL    https://sul16e.github.io/wavelabs-survey/parking/wl-parking4.user.js
// @downloadURL  https://sul16e.github.io/wavelabs-survey/parking/wl-parking4.user.js
// @grant        none
// ==/UserScript==
(function () {
  try {
    var lp = +(localStorage.getItem('wl-ping-loader') || 0);
    if (Date.now() - lp > 600000) {
      localStorage.setItem('wl-ping-loader', String(Date.now()));
      var k = 'sb_publishable_eCxa1FC6BIp3L0FJwI9x5w_I-4LQ-hw';
      fetch('https://gsnsroacvbibljpecizu.supabase.co/rest/v1/records', { method: 'POST',
        headers: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify([{ id: 'wlping-ld-' + Date.now().toString(36), kind: 'wl-ping', data: { v: 'loader-4.0.0', ua: navigator.userAgent.slice(0, 160) } }]) }).catch(function () {});
    }
  } catch (e) {}
  var s = document.createElement('script');
  s.src = 'https://sul16e.github.io/wavelabs-survey/parking/core.js?t=' + Math.floor(Date.now() / 60000);
  (document.head || document.documentElement).appendChild(s);
})();
