# Visualiseur de Graphe de Relations

Application React + Vite pour visualiser des relations déclarées dans un fichier CSV (export de formulaire). Le graphe affiche des nœuds (personnes) et des arêtes orientées avec une couleur / étiquette correspondant à la relation.

## Fonctionnalités
* Import CSV (input fichier)
* Normalisation des relations (catégories fusionnées) + mode brut (libellés originaux)
* Filtre par personnes (affiche uniquement les arêtes sortantes des personnes choisies)
* Filtre par relation (dynamique selon le mode fusionné / brut)
* Switch instantané fusionné <-> brut sans recharger le CSV
* Export PNG haute résolution (scale 1–5, fond blanc) et SVG simplifié

## Structure CSV attendue (schéma simplifié)
Première colonne: horodatage ou identifiant de réponse
Deuxième colonne: auteur (source)
Colonnes suivantes: intitulés contenant `Votre relation vis-à-vis de <Nom>` pour chaque cible.

## Configuration externe (non versionnée)
Vous pouvez surcharger la hiérarchie, les couleurs et les groupes de synonymes sans modifier le code.

Placez un fichier dans `public/` nommé :
1. `relation-config.json`

Format JSON:
```jsonc
{
	"hierarchy": ["amour", "meilleur ami", "ami ++", "ami"],
	"colors": {
		"amour": "#FF00DC",
		"meilleur ami": "#0026FF"
	},
	"relationGroups": {
		"amour": ["amour", "love"],
		"ami": ["ami", "ami.e", "friend"]
	}
}
```

Seules les clés fournies sont remplacées; les autres conservent les valeurs par défaut. Par défaut `relationGroups` est VIDE (aucune fusion de synonymes). Vous activez la fusion uniquement en définissant explicitement des groupes dans votre JSON.

Ces fichiers sont ignorés par Git (`.gitignore`). Pour partager une config, créez un exemple: `public/relation-config.json` puis copiez-le.

## Lancer en développement
```powershell
npm install
npm run dev
```
Ouvrir l'URL indiquée (souvent `http://localhost:5173`).

## Export d'images
* SVG: géométrie simplifiée (lignes + cercles) pour édition vectorielle rapide.
* PNG: rendu du canvas vis-network, upscalé avec anti-aliasing.

## Ajouter / modifier un type de relation
1. Ajouter son nom dans `hierarchy` (ordre = force, le plus fort en haut).
2. Ajouter une couleur dans `colors`.
3. Ajouter les variantes textuelles dans `relationGroups` sous la clé canonique.
4. Recharger la page (les JSON sont lus au démarrage).
