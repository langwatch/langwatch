-- Who started a Langy conversation (modules/langy): the person in the panel, or a module on
-- their behalf with nobody at the keyboard, such as a daily insights run. The column has a
-- constant default, so an image that does not know it keeps reading and writing the table,
-- and a row folded before this migration, or by such an image, reads as "interactive".
-- One statement on the table, with no rewrite: a constant default is stored in the catalogue.
ALTER TABLE "LangyConversationProjection"
  ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'interactive';

-- IRREVERSIBLE: Prisma migration files carry no executable down step by convention. Manual
-- rollback is safe once no image reads the column: the table is a read model, rebuilt by
-- replaying the event log.
