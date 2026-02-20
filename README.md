# ⏱️ Horamètre

**Calculateur d'heures de travail** conforme à la **CCN Jardineries & Graineteries (IDCC 1760)** et au Code du travail français.

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Fonctionnalités

- 🧑‍💼 **Gestion multi-employés** — ajout, modification, suppression
- 📅 **Saisie des heures** — vue liste ou vue semaine (grille responsive)
- ⚡ **Mode rapide** — définir des horaires types et cocher les jours travaillés
- 📊 **Calcul automatique** des heures supplémentaires (25% / 50%), majorations dimanche (+50%), jours fériés (+100%)
- 💰 **Estimation du salaire brut** avec taux horaire calculé
- 🖨️ **Export PDF / Impression** avec récapitulatif
- 🔗 **Partage par lien** des plannings
- 👥 **Vue fusionnée** de tous les employés sur une même période
- 🔒 **Authentification** par mot de passe (optionnelle)
- 🌙 **Mode sombre / clair**
- 📱 **Responsive** — fonctionne sur mobile, tablette et écrans ultrawide

## ⚖️ Règles appliquées

| Règle | Détail |
|-------|--------|
| Heures supplémentaires | +25% de la 36e à la 43e heure, +50% au-delà |
| Dimanche | Majoration de 50% |
| Jour férié | Majoration de 100% |
| Maximum journalier | 10h |
| Maximum hebdomadaire | 48h |

---

## 🚀 Installation

### Docker (recommandé)

```bash
git clone https://github.com/votre-user/horametre.git
cd horametre
docker compose up -d
```

L'application sera accessible sur **http://localhost:8080**

### Node.js

```bash
git clone https://github.com/votre-user/horametre.git
cd horametre
npm install
npm start
```

L'application sera accessible sur **http://localhost:3000**

---

## ⚙️ Configuration

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port du serveur | `3000` |
| `DB_PATH` | Chemin de la base SQLite | `./data/workhours.db` |
| `AUTH_PASSWORD` | Mot de passe d'accès (vide = pas d'auth) | `horametre` (Docker) |

### Authentification

L'authentification est **optionnelle**. Elle se configure via la variable d'environnement `AUTH_PASSWORD` :

```yaml
# docker-compose.yml
environment:
  - AUTH_PASSWORD=monMotDePasse    # Activer l'auth
  - AUTH_PASSWORD=                 # Désactiver l'auth
```

- Mot de passe par défaut en Docker : **`horametre`**
- Si la variable est vide ou absente → l'app est accessible sans login

---

## 🗂️ Structure du projet

```
horametre/
├── server.js              # API Express + auth + SQLite
├── package.json
├── Dockerfile
├── docker-compose.yml
├── data/
│   └── workhours.db       # Base de données SQLite (créée au 1er lancement)
└── public/
    ├── index.html          # Interface principale
    ├── login.html          # Page de connexion
    ├── css/
    │   └── style.css
    └── js/
        ├── app.js          # Logique frontend
        └── french-rules.js # Règles CCN & Code du travail
```

---

## 🛠️ Stack technique

- **Backend** — Node.js, Express, better-sqlite3
- **Frontend** — HTML, CSS (vanilla), JavaScript
- **Auth** — express-session (cookie signé)
- **Base de données** — SQLite (WAL mode)
- **Conteneurisation** — Docker, Alpine Linux

---

## 📝 Développement

```bash
# Lancer en mode dev (hot reload)
npm run dev

# Lancer avec auth
AUTH_PASSWORD=test npm run dev
```

## 📜 Licence

MIT
