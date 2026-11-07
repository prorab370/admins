
(function(){
  'use strict';
  /* CE QUE FAIT ANDROID QUAND ON CACHE UNE BARRE (lu dans le code, voir travail/plein-ecran/journal.md pour les sources).
     Le greffon appelle WindowInsetsControllerCompat (androidx core 1.17.0) SANS regler le comportement des barres : c'est donc
     celui d'Android par defaut, et il change avec la version.
     - Android 7 a 10 : cacher la barre du bas pose SYSTEM_UI_FLAG_HIDE_NAVIGATION sans mode immersif. Le premier toucher,
       n'importe ou, fait revenir les DEUX barres et ce toucher n'arrive pas au jeu.
     - Android 11 : comportement par defaut BEHAVIOR_SHOW_BARS_BY_TOUCH. Barre du bas cachee, le systeme pose une couche
       invisible qui avale le premier toucher et fait revenir la barre. Inutilisable pour un jeu.
     - Android 12 et plus : BEHAVIOR_DEFAULT. Les barres cachees ne reviennent que par un glissement depuis le bord ; le
       toucher normal va au jeu. Revenues, elles RESTENT : il faut les recacher.
     - La barre du HAUT seule, elle, ne revient jamais au toucher, sur aucune version : seulement par un glissement depuis le
       haut (et elle reste alors). D'ou la regle de l'auteur : la barre du haut partout, celle du bas a partir d'Android 12.
     ON RECACHE au retour au premier plan, au retour de la fenetre (volet des notifications), a la fermeture d'une pub (son
     ecran est une autre activite, qui regle ses propres barres), et quand un glissement a fait revenir une barre : la page
     change alors de taille, ou Capacitor reecrit ses variables --safe-area-inset-*. On attend CALME_MS sans aucun geste sur le
     jeu, pour laisser le temps de toucher un bouton de la barre revenue. Un filet repasse toutes les FILET_MS : cacher une
     barre deja cachee ne fait rien du tout. On ne touche a rien pendant qu'un champ de texte a la main (le clavier). */
  var PE = window.PLEIN_ECRAN = { dispo: false, oui: true, version: 0, enPub: false };
  var CLE = 'simulmoteur_plein_ecran_v1';
  try{ if (localStorage.getItem(CLE) === 'non') PE.oui = false; }catch(e){}
  var SB = null;
  try{
    var C = window.Capacitor;
    if (C && typeof C.getPlatform === 'function' && C.getPlatform() === 'android' &&
        typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins.SystemBars &&
        typeof C.Plugins.SystemBars.hide === 'function' && typeof C.Plugins.SystemBars.show === 'function') SB = C.Plugins.SystemBars;
  }catch(e){ SB = null; }
  if (!SB) return;
  PE.dispo = true;

  /* V1.1.99 : verification. Deux trous vus au banc. (1) Le joueur qui touche le jeu plus souvent que toutes les 3 s (en
     conduite) gardait une barre revenue POUR TOUJOURS : on attend toujours CALME_MS sans geste, mais jamais plus de MAX_MS
     apres son retour. (2) A la verticale, sur un telephone a encoche jusqu'a Android 14, la barre du haut peut revenir SANS
     que la page change de taille (la goutte de la camera a la hauteur de la barre) : seul le filet la voit. Il passait toutes
     les 20 s ; il passe toutes les FILET_MS = 8 s, et lui aussi au plus MAX_MS plus tard si le joueur touche sans arret. */
  var CALME_MS = 3000, TIC_MS = 1000, FILET_MS = 8000, MAX_MS = 10000, PUB_MAX_MS = 120000;
  var etat = '', dernierGeste = 0, dernierCache = 0, aVerifier = false, signalDepuis = 0, fenetreActive = true, minuterie = 0, pubDepuis = 0;
  function signaler(){ if (!aVerifier){ aVerifier = true; signalDepuis = Date.now(); } }     // V1.1.99 : l'heure du premier signal

  /* LA VERSION D'ANDROID. La vue web l'ecrit dans son user-agent (« Linux; Android 11; ... wv »). Google a annonce un user-agent
     REDUIT pour les vues web des prochains Android, fige a « Android 10; K » : la vraie version y est inconnue, et on la
     demande alors aux indications du client (vue web 116 et plus). Inconnue : on fait comme pour Android 11, la barre du bas
     reste - c'est le cote sans risque. */
  function versionUA(){
    var ua = String(navigator.userAgent || '');
    if (/Android 10; K[;)]/.test(ua)) return 0;
    var m = /Android (\d+)/.exec(ua);
    return m ? (parseInt(m[1], 10) || 0) : 0;
  }
  PE.version = versionUA();
  if (!PE.version){
    try{
      var uad = navigator.userAgentData;
      if (uad && typeof uad.getHighEntropyValues === 'function'){
        uad.getHighEntropyValues(['platformVersion']).then(function(h){
          if (!h || String(h.platform || uad.platform || '') !== 'Android') return;
          var v = parseInt(String(h.platformVersion || ''), 10);
          if (v > 0){ PE.version = v; bientot(0); }
        }, function(){});
      }
    }catch(e){}
  }
  PE.navCachee = function(){ return PE.version >= 12; };

  var PAS_UN_TEXTE = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'hidden', 'image'];
  function champTexte(){
    var el = document.activeElement;
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    if (el.tagName !== 'INPUT') return false;
    return PAS_UN_TEXTE.indexOf(String(el.getAttribute('type') || 'text').toLowerCase()) < 0;
  }
  /* Un appel au greffon : jamais d'erreur, ni levee ni promesse rejetee sans preneur. */
  function appel(nom, barre){
    try{
      var p = barre ? SB[nom]({ bar: barre }) : SB[nom]();
      if (p && typeof p.then === 'function') p.then(null, function(){});
    }catch(e){}
  }
  function cacher(){
    appel('hide', 'StatusBar');
    if (PE.navCachee()) appel('hide', 'NavigationBar');
    etat = 'cache'; dernierCache = Date.now(); aVerifier = false;
  }
  function montrer(){ appel('show'); etat = 'montre'; }
  /* La pub se ferme toujours par window.pubOuverte(false) (index.html, avec ses filets) ; au-dela de PUB_MAX_MS, on n'y croit plus. */
  function pubDevant(){
    if (PE.enPub && Date.now() - pubDepuis > PUB_MAX_MS) PE.enPub = false;
    return PE.enPub;
  }
  function peutCacher(){ return PE.oui && !pubDevant() && !document.hidden && fenetreActive && !champTexte(); }
  function appliquer(){
    if (!PE.oui){ if (etat === 'cache') montrer(); return; }
    if (peutCacher()) cacher(); else signaler();
  }
  function bientot(ms){
    clearTimeout(minuterie);
    minuterie = setTimeout(function(){ minuterie = 0; appliquer(); }, ms);
  }
  function tic(){
    if (!PE.oui || minuterie) return;
    var t = Date.now(), attente;
    if (aVerifier) attente = t - signalDepuis;     // V1.1.99 : depuis le retour signale de la barre
    else if (t - dernierCache >= FILET_MS) attente = t - dernierCache - FILET_MS;     // le filet
    else return;
    if (t - dernierGeste < CALME_MS && attente < MAX_MS) return;     // V1.1.99 : le calme, mais pas plus de MAX_MS
    if (peutCacher()) cacher();
  }

  /* Ce que le programme principal appelle. */
  PE.regler = function(oui){
    PE.oui = !!oui;
    try{ localStorage.setItem(CLE, PE.oui ? 'oui' : 'non'); }catch(e){}
    clearTimeout(minuterie); minuterie = 0;
    appliquer();
  };
  PE.pubOuverte = function(ouverte){
    PE.enPub = !!ouverte;
    if (PE.enPub){ pubDepuis = Date.now(); return; }
    fenetreActive = true;     // la pub avait pris la main : elle la rend en se fermant, meme si la vue web ne dit pas « focus »
    bientot(500);
  };

  /* Les gestes sur le jeu (le premier qui arrive suffit : une barre revenue par glissement en produit un). */
  function geste(){ dernierGeste = Date.now(); fenetreActive = true; }
  var GESTES = window.PointerEvent ? ['pointerdown', 'pointerup', 'pointercancel'] : ['touchstart', 'touchend', 'mousedown'];
  for (var i = 0; i < GESTES.length; i++) window.addEventListener(GESTES[i], geste, true);
  /* Une barre a pu revenir : la page change de taille (Android 14 et avant), ou Capacitor reecrit ses marges (Android 15 et
     plus, la page reste plein cadre). La rotation passe par le meme chemin. */
  window.addEventListener('resize', signaler);     // V1.1.99 : signaler() note l'heure du retour
  window.addEventListener('orientationchange', signaler);
  var ZONES = ['--safe-area-inset-top', '--safe-area-inset-right', '--safe-area-inset-bottom', '--safe-area-inset-left'];
  function lireZones(){
    var s = document.documentElement.style, r = '';
    for (var k = 0; k < ZONES.length; k++) r += s.getPropertyValue(ZONES[k]) + ',';
    return r;
  }
  if (window.MutationObserver){
    try{
      var zonesVues = lireZones();
      new MutationObserver(function(){
        var z = lireZones();
        if (z !== zonesVues){ zonesVues = z; signaler(); }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    }catch(e){}
  }
  /* Retours : la fenetre reprend la main (volet des notifications ferme, boite de dialogue), l'appli revient au premier plan,
     le clavier se ferme avec son champ. */
  window.addEventListener('blur', function(){ fenetreActive = false; });
  window.addEventListener('focus', function(){ fenetreActive = true; bientot(400); });
  document.addEventListener('visibilitychange', function(){ if (!document.hidden){ fenetreActive = true; bientot(400); } });
  document.addEventListener('focusout', function(e){
    var el = e && e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) bientot(600);
  }, true);
  window.addEventListener('load', function(){ bientot(300); });
  setInterval(tic, TIC_MS);
  appliquer();
})();
