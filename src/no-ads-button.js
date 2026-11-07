
    /* ===== LE BOUTON SANS PUB EST LA DES LA PREMIERE IMAGE (V1.0.89.339) =====
       Signalement : « le bouton supprimer pub met du temps a apparaitre ». Il attendait le programme principal, puis
       assets/achat.js, puis la reponse de Google Play : plusieurs secondes apres le menu. assets/achat.js garde la
       DERNIERE reponse de Google quand l'achat etait possible (simulmoteur_achat_vu_v1 : le prix, rien d'autre) ; ce
       script la lit en passant, et le bouton s'affiche avec le menu. La reponse du jour le corrige ensuite. Rien ici ne
       retire une publicite, et dans le navigateur il ne fait rien. */
    (function(){
      try{
        var C = window.Capacitor, b = document.getElementById('btnAchatSansPub');
        if (!b || window.SIM_DEMO === true || !(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform())) return;     // V1.1.0.30 : jamais dans la demo
        var vu = JSON.parse(localStorage.getItem('simulmoteur_achat_vu_v1') || 'null');
        if (!vu || typeof vu !== 'object') return;
        window.ACHAT_VU = vu;
        b.textContent = 'SANS PUB' + (vu.prix ? ' - ' + vu.prix : '');
        b.classList.remove('hidden');
      }catch(e){}
    })();
    