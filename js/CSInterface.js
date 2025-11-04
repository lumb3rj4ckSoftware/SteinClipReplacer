/* Minimaler CSInterface-Skeleton für CEP-Panels
 * Deckt evalScript (Bridge zu ExtendScript) ab.
 * Reicht für dieses Projekt vollkommen aus.
 */
(function (global) {
  'use strict';

  if (!global.__adobe_cep__) {
    console.warn('CSInterface: __adobe_cep__ nicht gefunden. Läuft nur innerhalb von Adobe-Apps.');
  }

  function CSInterface() {}

  /**
   * Führt ExtendScript im Host (Premiere) aus.
   * @param {string} script - ExtendScript-Quelltext/Funktionsaufruf
   * @param {function(string):void} callback - Ergebnis zurück aus ExtendScript (als String)
   */
  CSInterface.prototype.evalScript = function (script, callback) {
    if (!global.__adobe_cep__) {
      console.error('evalScript: kein __adobe_cep__ Kontext.');
      if (callback) callback('{"ok":false,"error":"no_cep"}');
      return;
    }
    try {
      global.__adobe_cep__.evalScript(script, function (res) {
        if (callback) callback(res);
      });
    } catch (e) {
      console.error('evalScript error:', e);
      if (callback) callback(String(e));
    }
  };

  // Optional: kleine Helper, stören nicht.
  CSInterface.prototype.getSystemPath = function () {
    return '';
  };
  CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    try { global.__adobe_cep__.openURLInDefaultBrowser(url); } catch (e) {}
  };

  global.CSInterface = CSInterface;
})(this);
