
    (function(){
      "use strict";
      /* Les six elements du cadran, releves une fois. Le programme principal a son propre
         `els`, qui n'existe pas encore a cet endroit de la page ; celui-ci porte le meme nom
         pour que le code demenage se lise exactement comme avant. */
      var els = {};
      ['tachyRouge', 'tachyGradM', 'tachyGradm', 'tachyChiffres', 'tachyUnite', 'tachyAiguille']
        .forEach(function(id){ els[id] = document.getElementById(id); });

      /* ===== LE CADRAN DE L'ACCUEIL, CALE SUR LA MACHINE (V0.9.27) =====
         Geometrie du cadran, inchangee depuis la V0.7.89 : centre en (120,100), rayon 84, un
         demi-tour de gauche a droite. Une fraction f de 0 a 1 se pose donc a l'angle
         180 - 180f degres, et l'aiguille tourne de (f - 0.5) x 180 puisqu'elle est dessinee
         vers le haut. Tout le reste se deduit de la fiche. */
      /* L'objet `accueil` qui portait l'etat de la voix (V0.9.88) est parti avec elle en
         V0.9.89 : plus de voix, donc plus d'etat a tenir, et plus de maximum de cadran a
         publier pour un lecteur qui n'existe plus. */
      var TACHY_CX = 120, TACHY_CY = 100, TACHY_R = 84;
      function tachyPt(f, r){
        var a = (180 - 180 * Math.max(0, Math.min(1, f))) * Math.PI / 180;
        return { x: TACHY_CX + r * Math.cos(a), y: TACHY_CY - r * Math.sin(a) };
      }
      /* L'ECHELLE EST CHOISIE, PAS CALCULEE AU PLUS JUSTE. Un cadran qui s'arreterait pile au
         rupteur n'aurait aucune marge et se lirait mal ; un vrai compte-tours porte un maximum
         ROND, un cran au-dessus. On cherche donc le plus petit pas de graduation de la liste
         qui donne entre quatre et huit intervalles - en dessous le cadran est vide, au-dessus
         il est illisible. 2500 est absent de la liste a dessein : il rendrait des maximums du
         genre 17 500, qui n'est pas un chiffre de cadran. */
      var TACHY_PAS = [100, 200, 250, 500, 1000, 2000, 4000, 5000];
      /* ===== LE MOTEUR DE VITRINE (V0.9.88) =====
         Demande : zone rouge a 8500 tours, et le son d'un V12 quand la sequence passe ses
         rapports. Les deux ne font qu'UNE decision, et c'est elle qu'il faut ecrire plutot que
         deux reglages sans rapport.

         8500 EST UN NOMBRE FIXE, et un nombre fixe ne peut pas venir de la fiche chargee : un
         camion s'arrete a 2500, une berline a 6300, une moto passe 10 500. Pose sur une machine
         qui ne monte pas si haut, l'arc rouge tomberait APRES le rupteur - l'aiguille n'y
         entrerait jamais et la zone rouge ne servirait plus a rien. Un V12 qui prend 8500 tours
         n'est pas davantage la voiture du joueur.

         L'ACCUEIL CESSE DONC DE DECRIRE LA MACHINE CHARGEE, et c'est la decision de la V0.9.27
         qui tombe. Elle etait juste tant que le cadran pretendait dire quelque chose du joueur ;
         depuis la V0.9.87 il ne mesure plus rien, il RACONTE un demarrage. Un cadran qui raconte
         n'a pas besoin d'etre celui de la voiture du garage - il a besoin d'etre toujours le
         meme, pour que la sequence, la zone rouge et le son parlent tous du meme moteur.
         Une seule ligne a changer le jour ou l'on voudrait revenir a la fiche. */
      var VITRINE = { rupteur: 9000, zoneRouge: 8500, ralenti: 900 };
      function tachyEchelle(rupteur){
        var vise = Math.max(300, rupteur * 1.06);
        for (var i = 0; i < TACHY_PAS.length; i++){
          var n = Math.ceil(vise / TACHY_PAS[i]);
          if (n >= 4 && n <= 8) return { pas: TACHY_PAS[i], n: n, max: n * TACHY_PAS[i] };
        }
        return { pas: 5000, n: 4, max: 20000 };
      }

      function majMenuTachy(){
        var g = els.tachyGradM;
        if (!g) return;
        /* Les trois reperes viennent de VITRINE et non plus de state.vehicle (V0.9.88) : voir
           la declaration. Tout le reste du cadran se deduit d'eux, exactement comme avant. */
        var rupteur = VITRINE.rupteur, rouge = VITRINE.zoneRouge, ralenti = VITRINE.ralenti;
        var e = tachyEchelle(rupteur);
        /* ===== LE CADRAN NE DESCEND PLUS SOUS 9000 (V0.9.87) =====
           Demande explicite. L'echelle calculee restait juste, mais elle donnait un cadran de
           5000 a une berline et de 3000 a un camion : sur l'accueil, ou le cadran est la pour
           montrer ce que sait faire un moteur, un demi-cadran fait un demi-effet.
           C'est un PLANCHER et non une valeur fixe : une machine qui a besoin de plus garde le
           sien - une moto qui monte a 11 000 conserve son cadran de 12 000, sans quoi son
           rupteur tomberait hors du dessin et sa zone rouge ne se dessinerait plus du tout.
           Dix graduations de mille, chiffrees de 0 a 9. */
        if (e.max < 9000) e = { pas: 1000, n: 9, max: 9000 };
        /* ===== ET IL RESTE GRADUE DE MILLE EN MILLE (V0.9.88) =====
           Au-dessus de 9000, tachyEchelle rend le pas de 2000 : cinq graduations pour dix mille
           tours, c'est-a-dire un cadran presque vide, alors que le plancher juste au-dessus en
           donne neuf pour neuf mille. Le maximum reste choisi par tachyEchelle - c'est lui qui
           cherche le chiffre rond au-dessus du rupteur - seule la GRADUATION est ramenee au
           mille. Les chiffres, eux, sont deja proteges : sautChiffre n'en ecrit qu'un sur deux
           des qu'ils passent a deux chiffres, donc 0 2 4 6 8 10 et jamais dix nombres colles. */
        else if (e.pas > 1000) e = { pas: 1000, n: Math.round(e.max / 1000), max: e.max };

        /* Le diviseur suit l'echelle. Un cadran de camion s'arrete a 3000 tours : l'ecrire en
           milliers donnerait « 0  0,5  1  1,5 », ce qu'aucun tableau de bord ne fait - il
           ecrit 0 10 20 30 et annonce x100 sous le moyeu. */
        var div = (e.max >= 4000) ? 1000 : 100;   /* lu par sautChiffre juste dessous */
        /* Au-dela de cinq intervalles on ne chiffre qu'une graduation sur deux, sinon les
           nombres se touchent... SAUF s'ils n'ont qu'un chiffre (V0.9.87). La regle se mesure
           maintenant au lieu de se supposer : a neuf intervalles, deux graduations voisines sont
           distantes de 2 x 57 x sin(10 deg), soit 19,8 px sur le rayon des chiffres. Un chiffre
           seul en occupe une dizaine, deux chiffres une vingtaine - le premier tient, le second
           non. C'est exactement ce qui permet au cadran de 9000 d'etre chiffre 0 1 2 ... 9,
           comme un vrai compte-tours, la ou l'ancienne regle aurait ecrit 0 2 4 6 8. */
        var sautChiffre = (e.n > 5 && e.max / div > 9) ? 2 : 1;

        var maj = '', min = '', chi = '', i, p, q, f;
        for (i = 0; i <= e.n; i++){
          f = i / e.n;
          p = tachyPt(f, TACHY_R); q = tachyPt(f, TACHY_R - 14);
          maj += '<line x1="' + p.x.toFixed(1) + '" y1="' + p.y.toFixed(1)
               + '" x2="' + q.x.toFixed(1) + '" y2="' + q.y.toFixed(1) + '"/>';
          if (i % sautChiffre === 0){
            var c = tachyPt(f, 57);
            chi += '<text x="' + c.x.toFixed(1) + '" y="' + (c.y + 4).toFixed(1) + '">'
                 + Math.round(i * e.pas / div) + '</text>';
          }
          if (i < e.n){
            f = (i + 0.5) / e.n;
            p = tachyPt(f, TACHY_R); q = tachyPt(f, TACHY_R - 7);
            min += '<line x1="' + p.x.toFixed(1) + '" y1="' + p.y.toFixed(1)
                 + '" x2="' + q.x.toFixed(1) + '" y2="' + q.y.toFixed(1) + '"/>';
          }
        }
        g.innerHTML = maj;
        if (els.tachyGradm) els.tachyGradm.innerHTML = min;
        if (els.tachyChiffres) els.tachyChiffres.innerHTML = chi;
        if (els.tachyUnite) els.tachyUnite.textContent = 'TR/MIN x' + div;

        /* Le maximum du cadran etait publie ICI pour la voix d'accueil, qui remontait de
           l'angle de l'aiguille au regime. La voix est partie en V0.9.89 et la publication
           avec elle : une valeur que plus personne ne lit est une valeur qu'on oublie de
           maintenir. `e.max` reste disponible dans cette fonction pour qui en aurait besoin. */

        /* L'arc rouge part de LA zone rouge de la vitrine. Si elle depassait le cadran, on ne
           dessine rien plutot qu'un arc qui reviendrait en arriere. */
        if (els.tachyRouge){
          var fr = rouge / e.max;
          if (fr >= 0.999 || fr <= 0) els.tachyRouge.setAttribute('d', '');
          else {
            var a = tachyPt(fr, TACHY_R), b = tachyPt(1, TACHY_R);
            els.tachyRouge.setAttribute('d', 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1)
              + ' A' + TACHY_R + ' ' + TACHY_R + ' 0 0 1 ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1));
          }
        }

        /* ===== L'AIGUILLE JOUE UNE SEQUENCE (V0.9.87) =====
           Elle ne respire plus autour du ralenti : elle rejoue ce que fait un moteur quand on
           le met en route. Balayage jusqu'au rupteur, retour a zero, coup de demarreur, ralenti,
           puis cinq montees separees par quatre passages de rapport, et on coupe.

           CE QUE CELA COUTE, ET C'EST ASSUME : l'objection de la V0.7.89, reprise en V0.9.27 -
           « un cadran qui annoncerait un regime pendant que le moteur est a l'arret serait un
           mensonge » - ne tient plus. La sequence RACONTE un demarrage, elle n'en mesure aucun,
           et elle tourne que le moteur soit lance ou non. C'est une illustration animee, et la
           classe .eteinte qui repondait a cette objection est partie avec.

           CE QUE CELA GARDE : tous les reperes viennent encore de la fiche chargee. Le balayage
           s'arrete au VRAI rupteur de la machine, les passages tombent en proportion de LUI, et
           le ralenti est le sien. Une berline monte a 6800 et un camion s'arrete a 2500 sur le
           meme cadran - la sequence est la meme, la mecanique qu'elle montre ne l'est pas.

           Les huit angles partent en proprietes personnalisees : une animation ne peut pas
           calculer, mais elle peut interpoler entre deux var(). */
        var ai = els.tachyAiguille;
        if (!ai) return;
        var ang = function(rpm){
          var f = Math.max(0, Math.min(1, rpm / e.max));
          return ((f - 0.5) * 180).toFixed(2) + 'deg';
        };
        ai.style.setProperty('--aigZero', ang(0));
        ai.style.setProperty('--aigRal',  ang(ralenti));
        /* Le coup de demarreur : le regime depasse toujours le ralenti avant d'y retomber. */
        ai.style.setProperty('--aigDem',  ang(ralenti * 1.9));
        ai.style.setProperty('--aigRup',  ang(rupteur));
        /* Les quatre passages. On retombe de plus en plus haut a chaque rapport - c'est ce qui
           fait qu'on RECONNAIT une boite : les rapports se resserrent en montant. Jamais sous
           le ralenti, sinon un camion dont le rupteur est bas calerait a chaque passage. */
        [0.42, 0.50, 0.57, 0.63].forEach(function(k, i){
          ai.style.setProperty('--aigP' + (i + 1), ang(Math.max(ralenti * 1.35, rupteur * k)));
        });
        /* Image fixe quand le systeme demande moins de mouvement : le ralenti, qui est le seul
           etat de la sequence ou un moteur se tient vraiment. */
        ai.style.setProperty('--aigMid', ang(ralenti));
      }

      /* Sur window d'abord : majMenuVehicule, dans le programme principal, doit la trouver
         meme si ce premier dessin echouait. Puis tout de suite - c'est la raison d'etre de
         ce script. */
      window.majMenuTachy = majMenuTachy;
      majMenuTachy();
    })();
    