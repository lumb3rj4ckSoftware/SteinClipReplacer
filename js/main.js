/* global CSInterface */
(function () {
  'use strict';
  const cs = new CSInterface();

  function evalJSX(script, cb) {
    cs.evalScript(script, function (res) {
      cb && cb(res);
    });
  }

  function quote(path) {
    if (!path) return '""';
    return '"' + path.replace(/\\/g, '\\\\') + '"';
  }

  function setStatus(msg, ok = true) {
    const s = document.getElementById('status');
    const e = document.getElementById('error');
    if (ok) {
      s.classList.add('ok'); s.textContent = msg || '';
      e.textContent = '';
    } else {
      e.textContent = msg || '';
      s.textContent = '';
    }
  }

  function onReady() {
    document.getElementById('browse').addEventListener('click', function () {
      // Native File-Dialog via JSX
      evalJSX('replacer_pickFile()', function (p) {
        if (p && p !== 'null' && p !== 'undefined') {
          document.getElementById('newPath').value = p;
        }
      });
    });

    document.getElementById('ping').addEventListener('click', function () {
      evalJSX('replacer_ping()', function (res) {
        setStatus('Premiere verbunden: ' + res, true);
      });
    });

    document.getElementById('run').addEventListener('click', function () {
      const path = document.getElementById('newPath').value.trim();
      const useSel = document.getElementById('useSelection').checked ? 'true' : 'false';
      if (!path) {
        setStatus('Bitte zuerst eine Datei wählen.', false);
        return;
      }
      setStatus('Arbeite…');
      const cmd = `replacer_run(${quote(path)}, ${useSel})`;
      evalJSX(cmd, function (res) {
        try {
          const o = JSON.parse(res);
          if (o.ok) {
            setStatus(`Fertig. V1 Δ=${o.v1DeltaFrames} Frames, V2 Δ=${o.v2DeltaFrames} Frames.`, true);
          } else {
            setStatus('Fehler: ' + o.error, false);
          }
        } catch (err) {
          setStatus('Unerwartete Antwort: ' + res, false);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
