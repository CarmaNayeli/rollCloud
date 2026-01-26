-- Add custom macros field to rollcloud_characters table
-- This enables persistence of custom spell macros across devices

-- Add custom_macros column for storing spell-specific custom macros
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rollcloud_characters' AND column_name = 'custom_macros'
    ) THEN
        ALTER TABLE rollcloud_characters ADD COLUMN custom_macros JSONB DEFAULT '{}';
        CREATE INDEX idx_rollcloud_characters_custom_macros ON rollcloud_characters(custom_macros);
        COMMENT ON COLUMN rollcloud_characters.custom_macros IS 'Custom spell macros configuration stored as JSON: {spellName: {buttons: [...], skipNormalButtons: boolean}}';
    END IF;
END $$;
