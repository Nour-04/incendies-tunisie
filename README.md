# Incendies en Tunisie

Site web qui affiche, **gouvernorat par gouvernorat**, les foyers actifs (feux de
forêt et de végétation) détectés par satellite en Tunisie. Les données proviennent
de **NASA FIRMS** (détections VIIRS des satellites S-NPP, NOAA-20 et NOAA-21) et
sont mises à jour **automatiquement chaque jour**.

Interface en français : carte interactive, classement des régions les plus
touchées, et détail par délégation.

## Comment ça marche

1. Un script Python ([`scripts/fetch_fires.py`](scripts/fetch_fires.py)) interroge
   l'API *area* de FIRMS pour l'emprise de la Tunisie, associe chaque détection à un
   gouvernorat et une délégation (test point-dans-polygone), et écrit
   [`data/fires.json`](data/fires.json). Les détections hors du territoire tunisien
   (Algérie, Libye, mer) sont ignorées.
2. Un *workflow* GitHub Actions ([`.github/workflows/update.yml`](.github/workflows/update.yml))
   exécute ce script tous les jours et publie le fichier mis à jour.
3. Le site statique (`index.html` + `assets/`) lit ce JSON et l'affiche avec
   [Leaflet](https://leafletjs.com/). Aucun serveur n'est nécessaire.

## Mise en place (une seule fois)

### 1. Clé NASA FIRMS
Obtenez une clé gratuite (« MAP_KEY ») sur
<https://firms.modaps.eosdis.nasa.gov/api/map_key/>.

### 2. Ajouter la clé comme *secret* GitHub
Dans votre dépôt : **Settings → Secrets and variables → Actions → New repository
secret**
- **Name** : `FIRMS_MAP_KEY`
- **Secret** : votre clé

> La clé n'est jamais stockée dans le code : elle reste dans les *secrets* GitHub.

### 3. Autoriser les Actions à publier
**Settings → Actions → General → Workflow permissions** → cocher
**« Read and write permissions »**.

### 4. Activer GitHub Pages
**Settings → Pages → Source** : *Deploy from a branch* → branche `main`, dossier
`/ (root)`. Le site sera en ligne à `https://<votre-utilisateur>.github.io/<dépôt>/`.

### 5. Premier remplissage des données
Onglet **Actions → « Mise à jour des foyers actifs » → Run workflow**, ou en local :

```bash
FIRMS_MAP_KEY=votre_cle python3 scripts/fetch_fires.py
```

## Développement local

```bash
# régénérer les données
FIRMS_MAP_KEY=votre_cle python3 scripts/fetch_fires.py
# servir le site
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Structure

```
index.html                     # page principale
assets/app.js, assets/style.css
data/fires.json                # généré quotidiennement (foyers + agrégats)
data/tunisia-adm1.json         # gouvernorats simplifiés (carte)
data/_adm1_full.json           # gouvernorats pleine résolution (script)
data/_adm2_full.json           # délégations pleine résolution (script)
scripts/fetch_fires.py         # récupération FIRMS + association aux régions
.github/workflows/update.yml   # mise à jour quotidienne
```

## Données & limites

- Chaque point est une **détection thermique** par satellite, pas nécessairement un
  incendie distinct confirmé au sol ; un même feu peut générer plusieurs points.
- Couverture temporelle : jusqu'à **5 jours** (limite de l'API *area* de FIRMS).
- Sources : NASA FIRMS (VIIRS NRT). Frontières :
  [geoBoundaries](https://www.geoboundaries.org) (ODbL).

Outil d'information — ne remplace pas les communications officielles de la
Protection civile. Urgence : **198**.
