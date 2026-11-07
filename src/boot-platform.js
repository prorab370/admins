
var IOS_NATIF = !!(window.Capacitor && typeof Capacitor.getPlatform === 'function' && Capacitor.getPlatform() === 'ios');
if (IOS_NATIF) document.documentElement.className += ' ios';
/* V1.2.1 (retour de l'auteur, 10/10 : sur iPhone, les fleches s'affichent en emoji - video d'un joueur) : IOS_TEXTE, l'iPhone et l'iPad
   QUELS QU'ILS SOIENT - l'application (IOS_NATIF) ou Safari (le site) - : tout ce qui demande la forme TEXTE d'un caractere que l'iPhone
   peindrait en emoji (LES FLECHES EN TEXTE) suit IOS_TEXTE, pas seulement IOS_NATIF. Classe iosTexte sur <html>. Android et le PC :
   ni la classe ni aucun changement. */
var IOS_TEXTE = IOS_NATIF || /iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (IOS_TEXTE) document.documentElement.className += ' iosTexte';
