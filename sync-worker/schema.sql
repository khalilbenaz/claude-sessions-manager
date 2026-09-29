-- Une ligne par session synchronisée. Les conversations (tables csm_transcripts / csm_chunks) arrivent
-- chiffrées par l'app : le serveur ne peut pas les lire.
-- space = empreinte SHA-256 du code de synchro : chaque code est un espace isolé.
CREATE TABLE IF NOT EXISTS csm_sessions (
  space     TEXT NOT NULL,
  uid       TEXT NOT NULL,      -- syncId, identique sur toutes les machines
  data      TEXT NOT NULL,      -- JSON : nom, dossier portable, modèle, groupe, couleur…
  updatedAt INTEGER NOT NULL,   -- horloge de la machine qui a modifié (last-write-wins)
  deleted   INTEGER NOT NULL DEFAULT 0,
  origin    TEXT NOT NULL DEFAULT '',
  rev       INTEGER NOT NULL,   -- compteur du serveur : curseur de pull indépendant des horloges
  PRIMARY KEY (space, uid)
);
CREATE INDEX IF NOT EXISTS csm_sessions_rev ON csm_sessions(space, rev);

-- Espaces créés par POST /spaces : empreinte de la clé d'accès (ou du code, avant la 3.8) ; ipHash limite les créations.
CREATE TABLE IF NOT EXISTS csm_spaces (
  space     TEXT PRIMARY KEY,
  createdAt INTEGER NOT NULL,
  ipHash    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS csm_spaces_created ON csm_spaces(createdAt);

-- Conversation en vigueur de chaque session : version (HMAC du contenu, calculé par l'app) et nombre de morceaux.
CREATE TABLE IF NOT EXISTS csm_transcripts (
  space     TEXT NOT NULL,
  uid       TEXT NOT NULL,      -- syncId de la session
  cid       TEXT NOT NULL,      -- identifiant de la conversation Claude Code
  ver       TEXT NOT NULL,
  chunks    INTEGER NOT NULL,
  size      INTEGER NOT NULL,   -- octets chiffrés
  updatedAt INTEGER NOT NULL,   -- date de modification du transcript sur la machine qui l'a envoyé
  origin    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (space, uid)
);

-- Morceaux chiffrés (1 Mo au plus, en base64).
CREATE TABLE IF NOT EXISTS csm_chunks (
  space TEXT NOT NULL,
  uid   TEXT NOT NULL,
  ver   TEXT NOT NULL,
  n     INTEGER NOT NULL,
  data  TEXT NOT NULL,
  PRIMARY KEY (space, uid, ver, n)
);

-- Clés d'accès rattachées à un espace créé avant la 3.8 (POST /spaces/link) : empreinte -> espace.
CREATE TABLE IF NOT EXISTS csm_auth (
  auth  TEXT PRIMARY KEY,
  space TEXT NOT NULL
);
