/**
 * Scenic Mountain Roofing — Color Studio
 * Swatch selection, live summary, and hand-off of choices into the estimate form.
 * Swatches are authored in the HTML so the page still reads correctly without JS.
 */
(function () {
  'use strict';

  var STORE_KEY = 'smr.colors.v1';

  function readStore() {
    try {
      return JSON.parse(window.localStorage.getItem(STORE_KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  function writeStore(state) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      /* Private mode or storage disabled — selection still works for this visit. */
    }
  }

  function init() {
    var studio = document.querySelector('.studio');
    if (!studio) return;

    var groups = Array.prototype.slice.call(studio.querySelectorAll('[data-group]'));
    if (!groups.length) return;

    var state = readStore();

    function summaryFor(key) {
      return studio.querySelector('[data-summary="' + key + '"]');
    }

    function hiddenFor(key) {
      return document.querySelector('#estimateForm [data-choice="' + key + '"]');
    }

    function paint(key, name, swatchStyle) {
      var summary = summaryFor(key);
      if (summary) {
        var value = summary.querySelector('.summary-value');
        var dot = summary.querySelector('.summary-dot');
        if (value) {
          value.textContent = name || 'Not selected';
          value.classList.toggle('is-empty', !name);
        }
        if (dot) {
          dot.style.background = name ? swatchStyle : '';
          if (!name) dot.removeAttribute('style');
        }
      }

      var hidden = hiddenFor(key);
      if (hidden) hidden.value = name || '';
    }

    groups.forEach(function (group) {
      var key = group.getAttribute('data-group');
      var swatches = Array.prototype.slice.call(group.querySelectorAll('.swatch'));

      function select(button, persist) {
        swatches.forEach(function (s) { s.setAttribute('aria-pressed', String(s === button)); });

        var name = button.getAttribute('data-name');
        var chip = button.querySelector('.swatch-chip');
        var style = chip ? window.getComputedStyle(chip).backgroundColor : '';

        paint(key, name, style);

        if (persist) {
          state[key] = name;
          writeStore(state);
        }
      }

      swatches.forEach(function (button) {
        button.addEventListener('click', function () { select(button, true); });
      });

      // Restore a prior selection
      if (state[key]) {
        var restored = swatches.filter(function (s) {
          return s.getAttribute('data-name') === state[key];
        })[0];
        if (restored) select(restored, false);
        else { delete state[key]; writeStore(state); }
      }
    });

    // "Send these colors with my request" — jump to the form
    var handoff = studio.querySelector('[data-studio-handoff]');
    if (handoff) {
      handoff.addEventListener('click', function () {
        var target = document.getElementById('estimate');
        if (!target) return;
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        // Must not be `input:not([type="hidden"])` — the first such input is the
        // FormSubmit `_honey` spam trap, and focusing it sends the visitor's
        // keystrokes into the honeypot, which silently discards the submission.
        var firstField = document.querySelector('#estimateForm .field input, #estimateForm .field select');
        if (firstField) window.setTimeout(function () { firstField.focus(); }, reduce ? 0 : 600);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
