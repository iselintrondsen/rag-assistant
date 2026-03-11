-- migration_groups.sql
--
-- Legger til valgfri gruppe-isolasjon på documents-tabellen.
-- Kjør manuelt dersom du vil skille kunnskapsbase per gruppe/team:
--
--   psql -U postgres -d rag_assistant -f src/db/migration_groups.sql
--
-- Etter migrering kan du sende ?group=gruppe1 på API-kall for å
-- isolere dokumenter og søk per gruppe.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS group_id VARCHAR(100) DEFAULT 'default';

CREATE INDEX IF NOT EXISTS documents_group_id_idx
  ON documents (group_id);
