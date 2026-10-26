// ==UserScript==
// @name         웨이브랩스 셀프 주차 등록 + 방문 경로
// @namespace    wavelabs
// @version      3.0.0
// @description  나이스파크 웹할인 화면에 웨이브랩스 셀프 주차 화면을 얹는다. 본체(core.js)는 매번 새로 불러와서 이 파일은 다시 설치할 필요 없음
// @match        https://npdc-i.nicepark.co.kr/*
// @run-at       document-end
// @updateURL    https://sul16e.github.io/wavelabs-survey/parking/wavelabs-parking.user.js
// @downloadURL  https://sul16e.github.io/wavelabs-survey/parking/wavelabs-parking.user.js
// @grant        none
// ==/UserScript==
(function () {
  var s = document.createElement('script');
  s.src = 'https://sul16e.github.io/wavelabs-survey/parking/core.js?t=' + Math.floor(Date.now() / 60000);
  (document.head || document.documentElement).appendChild(s);
})();
