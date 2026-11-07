
/* ===== V1.2.5 (LANGUES) : LES DICTIONNAIRES DES NOUVELLES LANGUES SONT DES FICHIERS A PART =====
   Demande de l'auteur (prompt « Langue », 20/10) : turc, grec, thai, arabe, coreen, chinois simplifie, indonesien. Les dix langues
   d'avant vivent dans ce fichier (4,7 Mo, 31 % de son poids) ; sept de plus l'auraient porte de 15 a 19 Mo, lus a chaque ouverture.
   Chaque nouvelle langue est donc un fichier, assets/langues/<code>.js (« SM_DICO.<code> = { phrase francaise : traduction } »),
   charge seulement pour la langue choisie : ici, avant le programme, celle que le joueur a gardee (ou celle de son telephone a la
   premiere ouverture) - une balise ecrite pendant la lecture de la page, lue avant le programme ; plus tard, au choix d'un drapeau,
   par le programme (chargerDico). SM_LANGUES_NOUVELLES dit quelles langues sont finies (1) : les autres ne sont ni proposees, ni
   choisies par le telephone. */
window.SM_LANGUES_NOUVELLES = { id: 1, tr: 1, el: 1, ko: 1, zh: 1, th: 1, ar: 1 };
window.SM_DICO = window.SM_DICO || {};
(function(){
  try {
    var N = window.SM_LANGUES_NOUVELLES, l = null, nav;
    try { l = localStorage.getItem('grimvex_langue') || localStorage.getItem('simmoteur_langue'); } catch (e){}
    if (!l){
      nav = (navigator.language || '').toLowerCase();
      l = nav.slice(0, 2);
      if (l === 'in') l = 'id';
      if (l === 'zh' && /^zh[-_](tw|hk|mo|hant)/.test(nav)) l = 'en';
    }
    if (l && N[l] === 1) document.write('<script src="assets/langues/' + l + '.js?v=' + RENDU3D_V + '"><\/script>');
  } catch (e){}
})();
