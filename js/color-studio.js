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

    /**
     * `label` is what the customer and the estimate both see, so for a shingle it
     * carries the product line as well as the colour ("IKO Dynasty® Granite
     * Black") — the two lines have separate palettes and the colour name alone
     * does not say which shingle to order. `tone` is a CSS colour and `image` an
     * optional swatch photo URL for the summary dot.
     */
    function paint(key, label, tone, image) {
      var summary = summaryFor(key);
      if (summary) {
        var value = summary.querySelector('.summary-value');
        var dot = summary.querySelector('.summary-dot');
        if (value) {
          value.textContent = label || 'Not selected';
          value.classList.toggle('is-empty', !label);
        }
        if (dot) {
          if (!label) dot.removeAttribute('style');
          else {
            dot.style.background = tone;
            if (image) dot.style.backgroundImage = 'url("' + image + '")';
          }
        }
      }

      var hidden = hiddenFor(key);
      if (hidden) hidden.value = label || '';
    }

    // The shingle group holds one grid per product line; collecting every swatch
    // under the group — not per grid — is what keeps the choice single across both.
    function labelOf(button) {
      var line = button.getAttribute('data-line');
      var name = button.getAttribute('data-name');
      return line ? line + ' ' + name : name;
    }

    groups.forEach(function (group) {
      var key = group.getAttribute('data-group');
      var swatches = Array.prototype.slice.call(group.querySelectorAll('.swatch'));

      function select(button, persist) {
        swatches.forEach(function (s) { s.setAttribute('aria-pressed', String(s === button)); });

        var label = labelOf(button);
        var chip = button.querySelector('.swatch-chip');
        var tone = chip ? window.getComputedStyle(chip).backgroundColor : '';
        // currentSrc so the dot reuses whichever ladder rung the chip already
        // fetched, rather than pulling a second file.
        var img = button.querySelector('.swatch-chip img');
        var image = img ? (img.currentSrc || img.src) : '';

        paint(key, label, tone, image);

        if (persist) {
          state[key] = label;
          writeStore(state);
        }
      }

      swatches.forEach(function (button) {
        button.addEventListener('click', function () { select(button, true); });
      });

      // Restore a prior selection. Matching on the composed label is also what
      // discards a value stored before the shingle palette changed, instead of
      // restoring a colour we no longer offer.
      if (state[key]) {
        var restored = swatches.filter(function (s) {
          return labelOf(s) === state[key];
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
        // Scoped to `.field` on purpose: the form also carries this studio's three
        // hidden colour inputs, and focus has to land on First name.
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
