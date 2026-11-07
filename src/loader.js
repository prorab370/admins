
/* ===== LE CHARGEUR, ET POURQUOI IL ESSAIE PLUSIEURS CHEMINS =====
   Deux balises <script src="assets/..."> en dur, c'etait supposer que la page est servie
   depuis son propre dossier. Elle ne l'est pas toujours : le lanceur la sert a 127.0.0.1/main,
   et depuis /main un chemin relatif "assets/three.min.js" pointe sur /assets/three.min.js,
   c'est-a-dire nulle part. Les deux fichiers etaient donc introuvables la ou le jeu se joue
   reellement, et introuvables SANS RIEN DIRE - une balise script en echec ne leve rien.
   On essaie donc les emplacements plausibles l'un apres l'autre, et on retient celui qui
   repond. Ce n'est pas une rustine : c'est la seule facon pour un fichier unique de ne pas
   dependre de l'endroit d'ou on l'ouvre, ce qui est precisement sa raison d'etre.
   Et l'echec complet est un ETAT LISIBLE, pas un silence : window.RENDU3D dit ce qui s'est
   passe, et le jeu s'en sert pour l'ecrire dans la barre de statut plutot que de laisser un
   bouton sans effet. */
/* ===== CE NUMERO SUIT CELUI DU JEU, ET LE COMMENTAIRE DISAIT L'INVERSE (V0.9.62) =====
   V0.7.25 avait ecrit ici « il n'avance qu'avec route3d.js ; la version du jeu peut le
   depasser », au motif tres defendable qu'avancer un cache-buster pour rien fait
   re-telecharger 680 Ko - three.min.js compris - sur un telephone.
   LA V0.8.6 A TRANCHE L'INVERSE, et le banc de version l'exige depuis : le numero suit celui
   du simulateur. La raison l'emporte sur l'economie - on ne peut pas, depuis un banc,
   comparer route3d.js a sa copie precedente ; livrer une camera modifiee en oubliant de
   toucher au numero sert donc l'ancien fichier a tous ceux qui sont deja venus, et ce
   defaut-la ne produit aucune erreur franche. Juste une correction qui « ne marche pas ».
   LE COMMENTAIRE, LUI, N'AVAIT PAS SUIVI - quatre versions durant, le fichier expliquait une
   regle que son propre banc interdisait. C'est la forme la plus couteuse de dette : celle ou
   la note contredit le controle, et ou l'on croit corriger en cassant.
   route3d.js declare le meme numero de son cote, et le jeu refuse de demarrer si les deux
   different : ils se changent donc ensemble, toujours. */
var RENDU3D_V = '1.3.1';
window.RENDU3D = { base: null, erreur: null, fini: false, attendu: RENDU3D_V };
(function(){
  var bases = ['assets/', 'simulation-moteur/assets/', '/simulation-moteur/assets/', './assets/'];
  var i = 0;
  function charger(url, ok, ko){
    var t = document.createElement('script');
    t.src = url; t.async = false;
    t.onload = ok; t.onerror = ko;
    document.head.appendChild(t);
  }
  function suivant(){
    if (i >= bases.length){
      window.RENDU3D.erreur = 'three.min.js et route3d.js introuvables';
      window.RENDU3D.fini = true;
      return;
    }
    var b = bases[i++];
    /* ===== LE PARAMETRE ?v= N'EST PAS DECORATIF =====
       Les trois meta Cache-Control du haut de page ne valent que pour le DOCUMENT. Les deux
       fichiers ci-dessous sont des requetes separees, que le navigateur garde en cache aussi
       longtemps qu'il veut : on peut donc se retrouver avec un index.html du jour et un
       route3d.js d'avant-hier. La porte d'entree entre les deux a deja change une fois, et un
       tel melange ne leve aucune erreur - il fabrique des NaN et une image vide.
       Le numero change a chaque version : le cache est contourne sans etre desactive. */
    charger(b + 'three.min.js?v=' + RENDU3D_V, function(){
      charger(b + 'route3d.js?v=' + RENDU3D_V, function(){
        window.RENDU3D.base = b; window.RENDU3D.fini = true;
        /* Le chargement est asynchrone : le jeu a pu demarrer avant. On lui fait reposer les
           deux canevas, sinon la 3D n'apparaitrait qu'au premier changement de circuit. */
        if (typeof window.majCanvasRendu === 'function') window.majCanvasRendu();
      }, suivant);
    }, suivant);
  }
  suivant();
})();
