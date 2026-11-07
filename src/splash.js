
/* ===== L'ECRAN DE DEMARRAGE REVIENT (V1.0.89.344) =====
   Demande : « remets le systeme de demarrage quand on ouvre l'appli, comme ca ca a le temps d'afficher le prix sans pub,
   comme avant ». L'ecran BIOS etait parti en V1.0.89.174 ; il revient, et il fait maintenant un travail : il couvre la
   premiere image jusqu'a ce que le programme soit lu en entier et, dans l'application, jusqu'a ce que Google ait donne le
   prix (window.ACHAT.dispo) - le menu apparait complet, bouton SANS PUB compris. Au moins deux secondes (les six lignes),
   au plus cinq : un magasin muet ne bloque pas le jeu. Un appui le passe.
   Il est ici, en tete de <body>, pour la raison ecrite sous le cadran de l'accueil (majMenuTachy) : le programme principal
   ne s'execute qu'une fois lu en entier, et le telephone peint la page avant lui. Le numero se relit dans le <title>, deja
   tenu a jour par incrementer-version.ps1 : pas une copie de plus a entretenir. */
(function(){
  var boot = document.getElementById('boot'), txt = document.getElementById('bootText');
  if (!boot || !txt) return;
  var ver = '';
  try { var m = /SIMULATION MOTEUR\s+(V[0-9][0-9.]*)/.exec(document.title || ''); if (m) ver = m[1]; } catch (e) {}
  var lignes = ['SIMUL-MOTEUR BIOS ' + ver + ' - TOUS DROITS RESERVES',
                'TEST MEMOIRE............... OK',
                'DETECTION CAPTEURS MOTEUR... OK',
                'CHARGEMENT VEHICULE PAR DEFAUT.. OK',
                '',
                'C:\\SIMULMOTEUR> DEMARRAGE.EXE_'];
  var t0 = Date.now(), MIN = 2000, MAX = 5000, fini = false, i = 0, vu = '';
  function natif(){
    try { var C = window.Capacitor; return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()); }
    catch (e) { return false; }
  }
  function cacher(){
    if (fini) return;
    fini = true;
    boot.style.transition = 'opacity .4s';
    boot.style.opacity = '0';
    setTimeout(function(){ boot.style.display = 'none'; }, 420);
  }
  function pret(){
    if (document.readyState === 'loading') return false;     // le programme n'est pas encore lu en entier
    if (!natif()) return true;                               // navigateur : aucun magasin a attendre
    var A = window.ACHAT;
    if (IOS_NATIF && A && A.repondu) return true;            // version iOS : le magasin a repondu, meme sans produit (voir achat.js)
    return !!(A && (A.dispo || A.possede));                  // le prix est connu, ou l'achat deja fait
  }
  var reduit = false;
  try { reduit = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  if (reduit){ txt.textContent = lignes.join('\n'); i = lignes.length; }
  else (function ligne(){
    if (fini || i >= lignes.length) return;
    vu += (i > 0 ? '\n' : '') + lignes[i];
    txt.textContent = vu;
    i++;
    setTimeout(ligne, 250);
  })();
  boot.addEventListener('click', cacher);
  (function surveiller(){
    if (fini) return;
    var t = Date.now() - t0;
    if (t >= MAX || (t >= MIN && i >= lignes.length && pret())){ setTimeout(cacher, 250); return; }
    setTimeout(surveiller, 120);
  })();
})();
