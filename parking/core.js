// 웨이브랩스 셀프 주차 등록 + 방문 경로 — 본체(아이패드의 Userscripts 로더가 매번 이 파일을 새로 불러온다)
// 고칠 땐 이 파일만 고치고 push → 아이패드는 다음 새로고침부터 바로 반영(재설치 필요 없음)
(function () {
  function main() {
    'use strict';
    if (window.__wlParking) return;
    window.__wlParking = true;

    // ---- 설정 ----
    var SB = 'https://gsnsroacvbibljpecizu.supabase.co/rest/v1/records';
    var KEY = 'sb_publishable_eCxa1FC6BIp3L0FJwI9x5w_I-4LQ-hw';
    var CH = ['네이버 지도', '카카오맵', '인스타그램', '엘리베이터 전단', '친구·지인 소개', '기타'];
    var OUR_SHOP = '3715';          // 나이스에 등록된 우리 상점 이름에 들어 있는 글자(「Office 3715호 텔온커피」)
    var MAX_HOURS = 2;              // 기본 1시간 무료 2번 = 2시간
    var MAX_IF_OTHER = 1;           // 다른 상가에서 이미 등록한 차면 최대 1시간
    var IDLE_MS = 60000, DONE_MS = 12000, STAFF_MS = 10 * 60000;
    var LS_Q = 'wl-visit-q', LS_STAFF = 'wl-staff-until', LS_TEST = 'wl-test', LS_DRY = 'wl-dry';

    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function staffOn() { return Date.now() < +(ls(LS_STAFF) || 0); }
    var DRY = ls(LS_DRY) === '1';   // 시험용: 할인권을 실제로 누르지 않음

    // ---- 나이스 통신 엿듣기(읽기만) ----
    var listeners = [];
    var lastCarTk = null;           // 고른 차에 이미 적용된 할인권 목록
    var carPicked = false;
    (function hook() {
      var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, url) { this.__wlUrl = String(url || ''); return open.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        var x = this;
        x.addEventListener('loadend', function () {
          var u = x.__wlUrl || '', body = null;
          try { body = JSON.parse(x.responseText); } catch (e) {}
          if (/selectCarDiscountTk(ForUpsquare|ForIpark)?List\.do/.test(u)) { lastCarTk = (body && body.dlt_list) || []; carPicked = true; }
          listeners.slice().forEach(function (f) { try { f(u, x.status, body); } catch (e) {} });
        });
        return send.apply(this, arguments);
      };
    })();
    function waitXhr(re, ms) {
      return new Promise(function (res) {
        var done = false;
        function f(u, st, body) { if (!done && re.test(u)) { done = true; off(); res({ ok: st >= 200 && st < 300 && !(body && body.errorMsgCode), st: st, body: body }); } }
        function off() { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }
        listeners.push(f);
        setTimeout(function () { if (!done) { done = true; off(); res({ ok: false, timeout: true }); } }, ms);
      });
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // 나이스 알림창(오류 안내) 글을 읽고 닫는다
    function readAndCloseAlert() {
      var msg = '';
      document.querySelectorAll('.w2window, .w2popup_window, [class*=popup]').forEach(function (w) {
        if (!w.getClientRects().length || getComputedStyle(w).visibility === 'hidden' || w.closest('#wl-root')) return;
        var t = (w.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 300 && /확인/.test(t)) {
          msg = msg || t.replace(/^알림\s*/, '').replace(/\s*확인\s*$/, '');
          var b = [].slice.call(w.querySelectorAll('input,button,a')).filter(function (x) { return /확인/.test(x.value || x.innerText || ''); })[0];
          if (b) b.click();
        }
      });
      return msg;
    }

    // ---- 응답 저장 ----
    function send(rows) {
      return fetch(SB, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); });
    }
    function loadQ() { try { return JSON.parse(ls(LS_Q) || '[]'); } catch (e) { return []; } }
    function saveQ(q) { try { localStorage.setItem(LS_Q, JSON.stringify(q.slice(-300))); } catch (e) {} }
    function flush() { var q = loadQ(); if (q.length) send(q).then(function () { saveQ([]); }).catch(function () {}); }
    function record(ch, hours, note) {
      var now = Date.now();
      var row = { id: 'visit-' + now.toString(36) + Math.random().toString(36).slice(2, 6), kind: 'visit',
        data: { ch: ch, at: now, src: '주차', hours: hours } };
      if (note) row.data.note = String(note).slice(0, 120);
      if (ls(LS_TEST) === '1' || DRY) row.data.test = 1;
      var q = loadQ(); q.push(row); saveQ(q); flush();
    }

    // ---- 할인권 적용 ----
    function hourTicket() {
      // 사용가능 할인권 중 「1시간 · 무료」 칸(유료는 노란색)
      return [].slice.call(document.querySelectorAll('.used_ticket_box.blue')).filter(function (b) {
        return /1시간/.test(b.innerText || '') && /무료/.test(b.innerText || '') && !b.closest('[id*=usedDcTk]');
      })[0];
    }
    function countHours(list, mine) {
      var min = 0;
      (list || []).forEach(function (d) {
        var isMine = String(d.webDisShpNm || '').indexOf(OUR_SHOP) >= 0;
        if (isMine !== mine) return;
        var knd = String(d.discountTkKnd || '');
        var m = knd.charAt(0) === '1' ? Number(knd.slice(1)) : 0;   // 1로 시작 = 시간권, 뒤 숫자 = 분
        min += (m || 0) * (Number(d.useCnt) || 1);
      });
      return min / 60;
    }
    async function applyHours() {
      var mineBefore = countHours(lastCarTk, true), others = countHours(lastCarTk, false);
      var want = (others > 0 ? MAX_IF_OTHER : MAX_HOURS) - mineBefore;
      var got = 0, note = '';
      for (var i = 0; i < want; i++) {
        if (DRY) { await sleep(700); got++; continue; }
        var b = hourTicket();
        if (!b) { note = '1시간 무료 칸을 못 찾음'; break; }
        var wait = waitXhr(/useOrCancelDiscountTk\.do/, 10000);
        var refresh = waitXhr(/selectPtnrShpDisInfoList\.do/, 10000);
        b.click();
        var r = await Promise.race([wait, (async function () { for (var k = 0; k < 20; k++) { await sleep(300); var m = readAndCloseAlert(); if (m) return { ok: false, alert: m }; } return new Promise(function () {}); })()]);
        if (!r.ok) { note = r.alert || readAndCloseAlert() || (r.timeout ? '응답 없음' : '적용 안 됨'); break; }
        got++;
        await refresh; await sleep(300);
      }
      return { got: got, mineBefore: mineBefore, others: others, note: note };
    }

    // ---- 화면 ----
    var css = [
      'html.wl-on #mf_grp_wrap #mf_wfm_header_layoutWrap.layoutWrap::before{content:none!important;display:none!important}',
      'html.wl-on #mf_grp_wrap #contentWrap .saleWrap{padding-left:16px!important;box-sizing:border-box}',
      '#wl-root{font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;-webkit-user-select:none;user-select:none}',
      '#wl-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;background:#0B5F84;color:#fff;display:flex;align-items:center;gap:16px;padding:12px 16px}',
      '#wl-bar .t{flex:1;font-size:19px;font-weight:800;line-height:1.4}',
      '#wl-bar .s{font-size:15px;font-weight:400;opacity:.9}',
      '#wl-root button{border:0;touch-action:manipulation;font-family:inherit;font-weight:800;cursor:pointer}',
      '#wl-bar button{min-height:48px;padding:0 20px;border-radius:12px;background:#fff;color:#0B5F84;font-size:17px}',
      '#wl-go{position:fixed;left:16px;right:336px;bottom:96px;z-index:2147482001;min-height:96px;border-radius:20px!important;background:#20769B!important;color:#fff;font-size:30px!important;box-shadow:0 6px 20px rgba(0,0,0,.25)}',
      '#wl-go.off,.wl-pane.off{display:none}',
      '.wl-pane{position:fixed;inset:0;z-index:2147483000;background:rgba(11,95,132,.97);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center}',
      '.wl-pane .tag{font-size:17px;opacity:.9;margin-bottom:12px}',
      '.wl-pane h1{font-size:34px;line-height:1.3;margin:0 0 28px;font-weight:800}',
      '.wl-pane .grid{display:grid;grid-template-columns:repeat(3,minmax(0,220px));gap:16px;width:100%;justify-content:center}',
      '.wl-pane .grid button{min-height:84px;border-radius:16px;background:#fff;color:#0B5F84;font-size:22px}',
      '.wl-pane .grid button:active{background:#6EAAC2;color:#fff}',
      '.wl-pane .big{font-size:52px;font-weight:800;margin:8px 0 12px}',
      '.wl-pane .big2{display:inline-block;background:#fff;color:#0B5F84;border-radius:18px;padding:8px 28px;font-size:46px;font-weight:800;margin:4px 0 16px}',
      '.wl-pane .sub{font-size:20px;opacity:.92;line-height:1.5}',
      '.wl-pane .home{margin-top:32px;min-height:56px;padding:0 28px;border-radius:14px;background:#fff;color:#0B5F84;font-size:20px}',
      '#wl-corner{position:fixed;top:0;left:0;width:80px;height:80px;z-index:2147483002}',
      '#wl-staff{position:fixed;top:8px;right:8px;z-index:2147483001;background:#C0392B;color:#fff;font:700 13px -apple-system,sans-serif;padding:6px 10px;border-radius:8px}'
    ].join('\n');

    function el(tag, attrs, html) {
      var e = document.createElement(tag);
      for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
      if (html != null) e.innerHTML = html;
      return e;
    }
    function home() { location.reload(); }

    function mask() {
      ['#gnbWrap', '.mobileMenu', '.mobileMypage', '#mf_wfm_body_carImgBtnId', '#mf_wfm_body_remainTkListMainBox',
        '#mf_wfm_body_usedTkListMainBox', '.keypadUsed'].forEach(function (s) {
        document.querySelectorAll(s).forEach(function (x) { x.style.setProperty('display', 'none', 'important'); });
      });
      var remark = document.getElementById('mf_wfm_body_remark');
      if (remark) { var row = remark.closest('tr') || remark.parentElement; if (row) row.style.setProperty('display', 'none', 'important'); }
      var cw = document.getElementById('contentWrap');
      if (cw) ['left', 'margin-left', 'padding-left'].forEach(function (p) { cw.style.setProperty(p, '0', 'important'); });
    }

    function carNoText() {
      var e = document.getElementById('mf_wfm_body_carNoText');
      return e ? (e.innerText || e.value || '').trim() : '';
    }

    function build() {
      document.head.appendChild(el('style', { id: 'wl-css' }, css));
      var root = el('div', { id: 'wl-root' });
      document.body.appendChild(root);

      var corner = el('div', { id: 'wl-corner' });
      root.appendChild(corner);
      var taps = [];
      corner.addEventListener('click', function () {
        var t = Date.now(); taps = taps.filter(function (x) { return t - x < 2000; }); taps.push(t);
        if (taps.length >= 5) { try { localStorage.setItem(LS_STAFF, String(t + STAFF_MS)); } catch (e) {} location.reload(); }
      });

      if (staffOn()) {
        root.appendChild(el('div', { id: 'wl-staff' }, '직원 모드 · 10분 뒤 손님 화면으로'));
        setTimeout(home, Math.max(1000, +(ls(LS_STAFF) || 0) - Date.now()));
        return;
      }
      document.documentElement.classList.add('wl-on');
      mask(); setInterval(mask, 1500);

      // 아래 안내 줄
      var bar = el('div', { id: 'wl-bar' },
        '<div class="t" id="wl-bar-t">차량번호 뒤 4자리를 누르고 OK<div class="s">건물 내 다른 상가에서 등록하신 경우 최대 1시간만 추가 가능</div></div>');
      var hb = el('button', { type: 'button' }, '처음으로');
      hb.addEventListener('click', home);
      bar.appendChild(hb);
      root.appendChild(bar);

      // 차를 고르면 나오는 큰 버튼
      var go = el('button', { type: 'button', id: 'wl-go', class: 'off' }, '주차 등록하기');
      root.appendChild(go);

      // 방문 경로 질문(닫기·넘어가기 없음)
      var ask = el('div', { class: 'wl-pane off', id: 'wl-ask' });
      ask.appendChild(el('div', { class: 'tag' }, '등록 전에 하나만 알려 주세요'));
      ask.appendChild(el('h1', null, '어디서 웨이브랩스를<br>보고 오셨어요?'));
      var grid = el('div', { class: 'grid' });
      ask.appendChild(grid);
      root.appendChild(ask);

      // 진행·결과
      var res = el('div', { class: 'wl-pane off', id: 'wl-res' });
      root.appendChild(res);

      var picked = '';
      CH.forEach(function (c) {
        var b = el('button', { type: 'button' }, c);
        b.addEventListener('click', function () { picked = c; run(); });
        grid.appendChild(b);
      });

      go.addEventListener('click', function () { ask.classList.remove('off'); });

      async function run() {
        ask.classList.add('off');
        res.innerHTML = '<div class="big">등록 중…</div><div class="sub">잠시만 기다려 주세요</div>';
        res.classList.remove('off');
        var car = carNoText();
        var r = await applyHours();
        var total = r.got + r.mineBefore;
        record(picked, r.got, r.note);
        if (total > 0) {
          res.innerHTML = '<div class="big">주차 등록 완료!</div>' +
            '<div class="big2">' + total + '시간 무료</div>' + (car ? '<div class="tag">' + car + '</div>' : '') +
            '<div class="sub">' + (r.others > 0 ? '다른 상가에서 등록한 시간과 함께 적용돼요' : '즐거운 시간 보내세요') +
            (r.note && r.got < (r.others > 0 ? MAX_IF_OTHER : MAX_HOURS) - r.mineBefore ? '<br>(' + r.note + ')' : '') + '</div>';
        } else {
          res.innerHTML = '<div class="tag">' + (car ? car + ' · ' : '') + '등록이 안 됐어요</div>' +
            '<div class="big">픽업대에 말씀해 주세요</div><div class="sub">' + (r.note || '') + '</div>';
        }
        var h = el('button', { type: 'button', class: 'home' }, '처음으로');
        h.addEventListener('click', home);
        res.appendChild(h);
        setTimeout(home, DONE_MS);
      }

      // 차가 골라지면 버튼 보이기
      setInterval(function () {
        var ready = carPicked && carNoText();
        go.classList.toggle('off', !ready || !ask.classList.contains('off') || !res.classList.contains('off'));
        if (ready) go.textContent = carNoText() + '  주차 등록하기';
        var t = document.getElementById('wl-bar-t');
        if (t) t.firstChild.nodeValue = ready ? '차량번호가 맞으면 「주차 등록하기」를 눌러 주세요' : '차량번호 뒤 4자리를 누르고 OK';
      }, 400);

      // 안 만지면 처음으로
      var last = Date.now();
      ['touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
        document.addEventListener(ev, function () { last = Date.now(); }, { passive: true, capture: true });
      });
      setInterval(function () {
        var busy = !res.classList.contains('off');
        if (!busy && (carPicked || !ask.classList.contains('off')) && Date.now() - last > IDLE_MS) home();
      }, 3000);

      // 시험용: 차를 고른 것처럼 보이기
      window.__wlSim = function (others) {
        carPicked = true; lastCarTk = others ? [{ webDisShpNm: '다른 상가', discountTkKnd: '10000060', useCnt: 1 }] : [];
        var e = document.getElementById('mf_wfm_body_carNoText'); if (e && !carNoText()) e.textContent = '12가3456';
      };
      flush();
    }

    var tries = 0;
    (function wait() {
      if (document.getElementById('mf_wfm_body_keypadOkBtn')) return build();
      if (++tries < 60) setTimeout(wait, 500);
    })();
  }
  main();
})();
