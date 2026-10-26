// ==UserScript==
// @name         웨이브랩스 셀프 주차 등록 + 방문 경로
// @namespace    wavelabs
// @version      1.0.0
// @description  나이스파크 웹할인 화면 앞에 「어디서 보고 오셨어요?」를 먼저 띄우고, 유료권·메뉴는 가린다(픽업대 아이패드용)
// @match        https://npdc-i.nicepark.co.kr/*
// @run-at       document-end
// @updateURL    https://sul16e.github.io/wavelabs-survey/parking/wavelabs-parking.user.js
// @downloadURL  https://sul16e.github.io/wavelabs-survey/parking/wavelabs-parking.user.js
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (window.__wlParking) return;
  window.__wlParking = true;

  // ---- 설정 ----
  var SB = 'https://gsnsroacvbibljpecizu.supabase.co/rest/v1/records';
  var KEY = 'sb_publishable_eCxa1FC6BIp3L0FJwI9x5w_I-4LQ-hw';
  var CH = ['네이버 지도', '카카오맵', '인스타그램', '엘리베이터 전단', '친구·지인 소개', '기타'];
  var IDLE_MS = 45000;          // 손님이 안 만지면 처음 화면으로
  var STAFF_MS = 10 * 60000;    // 직원 모드 유지 시간
  var LS_Q = 'wl-visit-q', LS_STAFF = 'wl-staff-until', LS_TEST = 'wl-test';

  function staffOn() { try { return Date.now() < +(localStorage.getItem(LS_STAFF) || 0); } catch (e) { return false; } }

  // ---- 응답 저장(실패하면 아이패드에 모았다가 다음에 다시 보냄) ----
  function send(rows) {
    return fetch(SB, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    }).then(function (r) { if (!r.ok) throw new Error(r.status); });
  }
  function loadQ() { try { return JSON.parse(localStorage.getItem(LS_Q) || '[]'); } catch (e) { return []; } }
  function saveQ(q) { try { localStorage.setItem(LS_Q, JSON.stringify(q.slice(-300))); } catch (e) {} }
  function flush() {
    var q = loadQ(); if (!q.length) return;
    send(q).then(function () { saveQ([]); }).catch(function () {});
  }
  function record(ch) {
    var now = Date.now();
    var row = { id: 'visit-' + now.toString(36) + Math.random().toString(36).slice(2, 6), kind: 'visit',
      data: { ch: ch, at: now, src: '주차' } };
    try { if (localStorage.getItem(LS_TEST) === '1') row.data.test = 1; } catch (e) {}
    var q = loadQ(); q.push(row); saveQ(q); flush();
  }

  // ---- 화면 꾸미기 ----
  var css = [
    '.wl-hide{display:none!important}',
    'html.wl-on #gnbWrap,html.wl-on .mobileMenu{display:none!important}',
    'html.wl-on #contentWrap{left:0!important;margin-left:0!important;width:100%!important;padding-left:0!important}',
    'html.wl-on .used_ticket_box.yellow,html.wl-on .keypadUsed,html.wl-on .keypad_help{display:none!important}',
    'html.wl-on #mf_wfm_body_remainTkListMainBox{zoom:1.4}',
    '#wl-ov{position:fixed;inset:0;z-index:2147483000;background:#0B5F84;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;-webkit-user-select:none;user-select:none}',
    '#wl-ov.off{display:none}',
    '#wl-ov .tag{font-size:16px;opacity:.85;margin-bottom:12px}',
    '#wl-ov h1{font-size:34px;line-height:1.3;margin:0 0 28px;text-align:center;font-weight:800}',
    '#wl-ov .grid{display:grid;grid-template-columns:repeat(3,minmax(0,220px));gap:16px;width:100%;justify-content:center}',
    '#wl-ov button{min-height:84px;border:0;border-radius:16px;background:#fff;color:#0B5F84;font-size:22px;font-weight:800;touch-action:manipulation;font-family:inherit}',
    '#wl-ov button:active{background:#6EAAC2;color:#fff}',
    '#wl-ov .foot{margin-top:24px;font-size:16px;opacity:.85}',
    '#wl-ov .corner{position:absolute;top:0;left:0;width:90px;height:90px}',
    '#wl-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;background:#0B5F84;color:#fff;display:flex;align-items:center;gap:16px;padding:12px 16px;font-family:-apple-system,"Apple SD Gothic Neo",sans-serif}',
    '#wl-bar .t{flex:1;font-size:17px;line-height:1.45}',
    '#wl-bar .t b{font-size:19px}',
    '#wl-bar button{min-height:48px;padding:0 20px;border:0;border-radius:12px;background:#fff;color:#0B5F84;font-size:17px;font-weight:800;touch-action:manipulation}',
    '#wl-staff{position:fixed;top:8px;right:8px;z-index:2147483001;background:#C0392B;color:#fff;font:700 13px -apple-system,sans-serif;padding:6px 10px;border-radius:8px}'
  ].join('\n');

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }

  var ov, bar, lastTouch = Date.now(), resetTimer = null;

  function showOverlay() { if (ov) ov.classList.remove('off'); }
  function hideOverlay() { if (ov) ov.classList.add('off'); lastTouch = Date.now(); }

  function goHome() {
    // 화면을 새로 열어 입력한 번호·조회 결과를 지우고 첫 질문으로
    location.reload();
  }

  function build() {
    document.head.appendChild(el('style', { id: 'wl-css' }, css));
    if (staffOn()) {
      var s = el('div', { id: 'wl-staff' }, '직원 모드 · 10분 뒤 손님 화면으로');
      document.body.appendChild(s);
      setTimeout(function () { location.reload(); }, Math.max(1000, +(localStorage.getItem(LS_STAFF) || 0) - Date.now()));
      return;
    }
    document.documentElement.classList.add('wl-on');

    // 주차 화면에 불필요한 칸 가리기(왼쪽 메뉴 · 사진조회 · 비고 · 유료권) — 사이트 CSS가 !important로 덮어서 요소에 직접 넣고 2초마다 다시 확인
    function mask() {
      var hide = ['#gnbWrap', '.mobileMenu', '.mobileMypage', '#mf_wfm_body_carImgBtnId', '.used_ticket_box.yellow', '.keypadUsed'];
      hide.forEach(function (s) {
        document.querySelectorAll(s).forEach(function (x) { x.style.setProperty('display', 'none', 'important'); });
      });
      var remark = document.getElementById('mf_wfm_body_remark');
      if (remark) { var row = remark.closest('tr') || remark.parentElement; if (row) row.style.setProperty('display', 'none', 'important'); }
      var cw = document.getElementById('contentWrap');
      if (cw) ['left', 'margin-left', 'padding-left'].forEach(function (p) { cw.style.setProperty(p, '0', 'important'); });
    }
    mask();
    setInterval(mask, 2000);

    // 첫 질문
    ov = el('div', { id: 'wl-ov' });
    ov.appendChild(el('div', { class: 'corner' }));
    ov.appendChild(el('div', { class: 'tag' }, '주차 등록 전에 하나만 알려 주세요'));
    ov.appendChild(el('h1', null, '어디서 웨이브랩스를<br>보고 오셨어요?'));
    var grid = el('div', { class: 'grid' });
    CH.forEach(function (c) {
      var b = el('button', { type: 'button' }, c);
      b.addEventListener('click', function () { record(c); hideOverlay(); });
      grid.appendChild(b);
    });
    ov.appendChild(grid);
    ov.appendChild(el('div', { class: 'foot' }, '누르면 바로 주차 등록 화면으로 넘어가요'));
    document.body.appendChild(ov);

    // 직원 모드: 왼쪽 위 모서리를 2초 안에 5번 누르면 10분 동안 원래 화면
    var taps = [];
    ov.querySelector('.corner').addEventListener('click', function () {
      var t = Date.now(); taps = taps.filter(function (x) { return t - x < 2000; }); taps.push(t);
      if (taps.length >= 5) { try { localStorage.setItem(LS_STAFF, String(t + STAFF_MS)); } catch (e) {} location.reload(); }
    });

    // 아래 안내 줄
    bar = el('div', { id: 'wl-bar' },
      '<div class="t"><b>차량번호 뒤 4자리 → OK → 「1시간 무료」 2번 = 2시간 무료</b><br>' +
      '건물 내 다른 상가에서 등록하신 경우 최대 1시간만 추가 가능</div>');
    var home = el('button', { type: 'button' }, '처음으로');
    home.addEventListener('click', goHome);
    bar.appendChild(home);
    document.body.appendChild(bar);

    // 안 만지면 처음으로
    ['touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () { lastTouch = Date.now(); }, { passive: true, capture: true });
    });
    resetTimer = setInterval(function () {
      if (ov.classList.contains('off') && Date.now() - lastTouch > IDLE_MS) goHome();
    }, 3000);

    flush();
  }

  // WebSquare 화면이 다 그려질 때까지 기다림(로그인 화면이면 아무것도 안 함)
  var tries = 0;
  (function wait() {
    if (document.getElementById('mf_wfm_body_keypadOkBtn')) return build();
    if (++tries < 60) setTimeout(wait, 500);
  })();
})();
