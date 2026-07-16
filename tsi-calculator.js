/* =====================================================================
   TSI floating calculator (tsi-calculator.js)
   ---------------------------------------------------------------------
   Models the actual TSIA2 on-screen calculator, not the full physical
   TI-108: sequential (non-algebraic) four-function arithmetic plus a
   single-register memory (M+ / M- / MRC). Deliberately NO %, no square
   root, no +/- sign key — those exist on the physical device but not on
   the on-screen tool this replicates. The physical TI-108's "automatic
   constant" repeat-equals feature is also deliberately left out — see
   tsi_ar_tweaking_log.md for the scope note and the source-of-truth
   testing this state machine went through (calc-dev/test-calc-logic.js,
   calc-dev/fuzz-calc.js — 29 targeted cases + ~19,400 randomized chains
   checked against an independent reference evaluator).

   Include with a single <script src="../tsi-calculator.js"></script> on
   any practice page. Self-contained: injects its own toggle button and
   panel into <body>, no HTML changes needed on the host page. Styling
   lives in tsi-theme.css (shared by every TSI page already).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__TSI_CALC_INIT__) return; // guard against accidental double-include
  window.__TSI_CALC_INIT__ = true;

  /* ---------------- state machine (see calc-dev/calc-logic.js for the tested source) ---------------- */
  var MAX_DIGITS = 8;
  var MAX_VALUE = 99999999;

  function newCalcState() {
    return {
      entryStr: '0', accumulator: 0, pendingOp: null,
      typingFresh: true, operandPending: false,
      memory: 0, error: false, lastWasClear: false, lastWasMRC: false
    };
  }

  function formatNumber(n) {
    if (Object.is(n, -0)) n = 0;
    if (n === 0) return '0';
    var neg = n < 0;
    var abs = Math.abs(n);
    if (abs > MAX_VALUE + 0.5) return null;
    var s;
    if (Number.isInteger(abs)) {
      s = String(abs);
      if (s.length > MAX_DIGITS) return null;
    } else {
      var intLen = String(Math.floor(abs)).length;
      var decPlaces = Math.max(0, MAX_DIGITS - intLen);
      s = abs.toFixed(decPlaces);
      if (Math.floor(parseFloat(s)) > MAX_VALUE) return null;
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return (neg ? '-' : '') + s;
  }

  function applyOp(a, op, b) {
    var r;
    if (op === '+') r = a + b;
    else if (op === '-') r = a - b;
    else if (op === '*') r = a * b;
    else if (op === '/') { if (b === 0) return { error: true }; r = a / b; }
    else return { error: true };
    if (!isFinite(r) || Math.abs(r) > MAX_VALUE + 0.5) return { error: true };
    return { error: false, value: r };
  }

  function pressDigit(s, d) {
    if (s.error) return s;
    s.lastWasClear = false; s.lastWasMRC = false;
    if (s.typingFresh) {
      s.entryStr = (d === '0') ? '0' : d;
      s.typingFresh = false;
    } else {
      var digitCount = s.entryStr.replace('.', '').replace('-', '').length;
      if (s.entryStr === '0') { s.entryStr = d; }
      else if (digitCount < MAX_DIGITS) { s.entryStr += d; }
    }
    s.operandPending = true;
    return s;
  }

  function pressDecimal(s) {
    if (s.error) return s;
    s.lastWasClear = false; s.lastWasMRC = false;
    if (s.typingFresh) { s.entryStr = '0.'; s.typingFresh = false; }
    else if (s.entryStr.indexOf('.') === -1) { s.entryStr += '.'; }
    s.operandPending = true;
    return s;
  }

  function pressOp(s, op) {
    if (s.error) return s;
    s.lastWasClear = false; s.lastWasMRC = false;
    var currentVal = parseFloat(s.entryStr);
    if (s.operandPending) {
      if (s.pendingOp) {
        var res = applyOp(s.accumulator, s.pendingOp, currentVal);
        if (res.error) { s.error = true; return s; }
        s.accumulator = res.value;
      } else {
        s.accumulator = currentVal;
      }
    }
    s.pendingOp = op;
    s.entryStr = formatNumber(s.accumulator) || '0';
    s.typingFresh = true;
    s.operandPending = false;
    return s;
  }

  function pressEquals(s) {
    if (s.error) return s;
    s.lastWasClear = false; s.lastWasMRC = false;
    var currentVal = parseFloat(s.entryStr);
    if (s.pendingOp) {
      var res = applyOp(s.accumulator, s.pendingOp, currentVal);
      if (res.error) { s.error = true; return s; }
      s.accumulator = res.value;
      s.entryStr = formatNumber(s.accumulator) || '0';
    }
    s.pendingOp = null;
    s.typingFresh = true;
    s.operandPending = false;
    return s;
  }

  function pressClear(s) {
    if (s.error) {
      s.error = false; s.accumulator = 0; s.pendingOp = null;
      s.entryStr = '0'; s.typingFresh = true; s.operandPending = false;
      s.lastWasClear = false; s.lastWasMRC = false;
      return s;
    }
    if (s.lastWasClear) {
      s.accumulator = 0; s.pendingOp = null; s.entryStr = '0';
      s.typingFresh = true; s.operandPending = false;
      s.lastWasClear = false;
    } else {
      s.entryStr = '0'; s.typingFresh = true; s.operandPending = false;
      s.lastWasClear = true;
    }
    s.lastWasMRC = false;
    return s;
  }

  function pressMRC(s) {
    if (s.error) return s;
    s.lastWasClear = false;
    if (s.lastWasMRC) {
      s.memory = 0;
      s.lastWasMRC = false;
    } else {
      s.entryStr = formatNumber(s.memory) || '0';
      s.typingFresh = true;
      s.operandPending = true;
      s.lastWasMRC = true;
    }
    return s;
  }

  function pressMemAdd(s) {
    if (s.error) return s;
    s.lastWasClear = false; s.lastWasMRC = false;
    var v = parseFloat(s.entryStr);
    var newMem = s.memory + v;
    if (Math.abs(newMem) > MAX_VALUE + 0.5) { s.error = true; return s; }
    s.memory = newMem;
    s.typingFresh = true;
    return s;
  }

  function pressMemSub(s) {
    if (s.error) return s;
    s.lastWasClear = false; s.lastWasMRC = false;
    var v = parseFloat(s.entryStr);
    var newMem = s.memory - v;
    if (Math.abs(newMem) > MAX_VALUE + 0.5) { s.error = true; return s; }
    s.memory = newMem;
    s.typingFresh = true;
    return s;
  }

  /* ---------------- DOM layer ---------------- */
  var state = newCalcState();

  var BTN_DEFS = [
    { label: 'ON/C', cls: 'ctrl', action: 'clear' },
    { label: 'MRC', cls: 'ctrl', action: 'mrc' },
    { label: 'M\u2212', cls: 'ctrl', action: 'm-' },
    { label: 'M+', cls: 'ctrl', action: 'm+' },
    { label: '7', cls: '', action: 'digit', arg: '7' },
    { label: '8', cls: '', action: 'digit', arg: '8' },
    { label: '9', cls: '', action: 'digit', arg: '9' },
    { label: '\u00f7', cls: 'op', action: 'op', arg: '/' },
    { label: '4', cls: '', action: 'digit', arg: '4' },
    { label: '5', cls: '', action: 'digit', arg: '5' },
    { label: '6', cls: '', action: 'digit', arg: '6' },
    { label: '\u00d7', cls: 'op', action: 'op', arg: '*' },
    { label: '1', cls: '', action: 'digit', arg: '1' },
    { label: '2', cls: '', action: 'digit', arg: '2' },
    { label: '3', cls: '', action: 'digit', arg: '3' },
    { label: '\u2212', cls: 'op', action: 'op', arg: '-' },
    { label: '0', cls: '', action: 'digit', arg: '0' },
    { label: '.', cls: '', action: 'dec' },
    { label: '=', cls: 'eq', action: 'eq' },
    { label: '+', cls: 'op', action: 'op', arg: '+' }
  ];

  function calcIconSVG() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="4" y="2" width="16" height="20" rx="2"></rect>' +
      '<line x1="8" y1="6" x2="16" y2="6"></line>' +
      '<line x1="8" y1="10" x2="8" y2="10.01"></line>' +
      '<line x1="12" y1="10" x2="12" y2="10.01"></line>' +
      '<line x1="16" y1="10" x2="16" y2="10.01"></line>' +
      '<line x1="8" y1="14" x2="8" y2="14.01"></line>' +
      '<line x1="12" y1="14" x2="12" y2="14.01"></line>' +
      '<line x1="16" y1="14" x2="16" y2="14.01"></line>' +
      '<line x1="8" y1="18" x2="16" y2="18"></line>' +
      '</svg>';
  }

  function calcButtonsHTML() {
    return BTN_DEFS.map(function (b) {
      return '<button type="button" class="calcBtn' + (b.cls ? ' ' + b.cls : '') + '" data-action="' + b.action + '"' +
        (b.arg ? ' data-arg="' + b.arg + '"' : '') + ' aria-label="' + b.label + '">' + b.label + '</button>';
    }).join('');
  }

  function calcPanelHTML() {
    return '<div class="calcHead"><b>Calculator</b><button type="button" class="calcCloseBtn" id="calcCloseBtn" aria-label="Close calculator">\u00d7</button></div>' +
      '<div class="calcDisplayWrap">' +
      '<div class="calcIndicators"><span id="calcMemInd">M</span><span id="calcErrInd">ERROR</span></div>' +
      '<div class="calcDisplay" id="calcDisplay" aria-live="polite">0</div>' +
      '</div>' +
      '<div class="calcGrid" id="calcGrid">' + calcButtonsHTML() + '</div>';
  }

  function render() {
    var d = document.getElementById('calcDisplay');
    if (d) d.textContent = state.error ? 'Error' : state.entryStr;
    var m = document.getElementById('calcMemInd');
    if (m) m.classList.toggle('on', state.memory !== 0);
    var e = document.getElementById('calcErrInd');
    if (e) e.classList.toggle('on', state.error);
  }

  function handleAction(action, arg) {
    if (action === 'digit') state = pressDigit(state, arg);
    else if (action === 'dec') state = pressDecimal(state);
    else if (action === 'op') state = pressOp(state, arg);
    else if (action === 'eq') state = pressEquals(state);
    else if (action === 'clear') state = pressClear(state);
    else if (action === 'mrc') state = pressMRC(state);
    else if (action === 'm+') state = pressMemAdd(state);
    else if (action === 'm-') state = pressMemSub(state);
    render();
  }

  function buildUI() {
    var toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'calcToggle'; toggle.id = 'calcToggleBtn';
    toggle.setAttribute('aria-label', 'Open calculator');
    toggle.innerHTML = calcIconSVG();
    document.body.appendChild(toggle);

    var panel = document.createElement('div');
    panel.className = 'calcPanel'; panel.id = 'calcPanel';
    panel.innerHTML = calcPanelHTML();
    document.body.appendChild(panel);

    function setOpen(open) {
      panel.classList.toggle('show', open);
      toggle.classList.toggle('active', open);
    }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!panel.classList.contains('show'));
    });
    document.getElementById('calcCloseBtn').addEventListener('click', function () { setOpen(false); });
    document.getElementById('calcGrid').addEventListener('click', function (e) {
      var btn = e.target.closest('.calcBtn');
      if (!btn) return;
      handleAction(btn.getAttribute('data-action'), btn.getAttribute('data-arg'));
    });
    document.addEventListener('click', function (e) {
      if (!panel.classList.contains('show')) return;
      if (e.target.closest('#calcPanel') || e.target.closest('#calcToggleBtn')) return;
      setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (!panel.classList.contains('show')) return;
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return; // don't steal keystrokes meant for an answer box
      if (e.key === 'Escape') { setOpen(false); return; }
      if (/^[0-9]$/.test(e.key)) { handleAction('digit', e.key); e.preventDefault(); return; }
      if (e.key === '.') { handleAction('dec'); e.preventDefault(); return; }
      if (e.key === '+') { handleAction('op', '+'); e.preventDefault(); return; }
      if (e.key === '-') { handleAction('op', '-'); e.preventDefault(); return; }
      if (e.key === '*') { handleAction('op', '*'); e.preventDefault(); return; }
      if (e.key === '/') { handleAction('op', '/'); e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === '=') { handleAction('eq'); e.preventDefault(); return; }
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
})();
