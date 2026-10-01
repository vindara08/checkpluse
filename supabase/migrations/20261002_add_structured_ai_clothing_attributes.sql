begin;

-- ============================================================
-- THE FOLD — CLOTHING ITEMS SCHEMA EVOLUTION
-- ============================================================
-- Preserves existing wardrobe IDs, outfit relationships,
-- and existing notes.
--
-- Does NOT assume that old columns named `color` or
-- `subcategory` exist in the deployed database.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Add / ensure the new structured clothing fields
-- ------------------------------------------------------------

alter table public.clothing_items
    add column if not exists dominant_color text;

alter table public.clothing_items
    add column if not exists clothing_type text;

alter table public.clothing_items
    add column if not exists secondary_color text
        check (
            secondary_color is null
            or char_length(secondary_color) <= 40
        );

alter table public.clothing_items
    add column if not exists color_family text
        check (
            color_family is null
            or char_length(color_family) <= 40
        );

alter table public.clothing_items
    add column if not exists brightness text
        check (
            brightness is null
            or char_length(brightness) <= 30
        );

alter table public.clothing_items
    add column if not exists pattern text
        check (
            pattern is null
            or char_length(pattern) <= 40
        );

alter table public.clothing_items
    add column if not exists formality text;

alter table public.clothing_items
    add column if not exists occasion text;

alter table public.clothing_items
    add column if not exists updated_at timestamptz
        not null default now();


-- ------------------------------------------------------------
-- 2. Preserve existing information if older columns exist
-- ------------------------------------------------------------
-- These blocks copy old values only when the legacy columns
-- actually exist.
--
-- This avoids failing if `color` or `subcategory` are absent.
-- ------------------------------------------------------------

do $$
begin

    -- Legacy color -> dominant_color
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'clothing_items'
          and column_name = 'color'
    ) then

        execute '
            update public.clothing_items
            set dominant_color = color
            where dominant_color is null
              and color is not null
        ';

    end if;


    -- Legacy subcategory -> clothing_type
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'clothing_items'
          and column_name = 'subcategory'
    ) then

        execute '
            update public.clothing_items
            set clothing_type = subcategory
            where clothing_type is null
              and subcategory is not null
        ';

    end if;

end $$;


-- ------------------------------------------------------------
-- 3. Remove old confidence fields
-- ------------------------------------------------------------
-- Confidence is internal AI metadata, not wardrobe data.
-- ------------------------------------------------------------

alter table public.clothing_items
    drop column if exists pattern_confidence;

alter table public.clothing_items
    drop column if exists detection_confidence;


-- ------------------------------------------------------------
-- 4. Existing historical rows
-- ------------------------------------------------------------
-- Do NOT invent values for old wardrobe items.
--
-- Existing rows may contain NULL / blank values.
-- New application-created records must provide the
-- required user fields.
--
-- Therefore the constraints below are NOT VALID.
-- ------------------------------------------------------------


-- Remove these constraints first if a previous partial
-- migration created them.

alter table public.clothing_items
    drop constraint if exists clothing_items_season_required;

alter table public.clothing_items
    drop constraint if exists clothing_items_formality_required;

alter table public.clothing_items
    drop constraint if exists clothing_items_occasion_required;

alter table public.clothing_items
    drop constraint if exists clothing_items_season_length;

alter table public.clothing_items
    drop constraint if exists clothing_items_formality_length;

alter table public.clothing_items
    drop constraint if exists clothing_items_occasion_length;


-- Season
alter table public.clothing_items
    add constraint clothing_items_season_required
    check (
        season is not null
        and btrim(season) <> ''
    )
    not valid;


-- Formality
alter table public.clothing_items
    add constraint clothing_items_formality_required
    check (
        formality is not null
        and btrim(formality) <> ''
    )
    not valid;


-- Occasion
alter table public.clothing_items
    add constraint clothing_items_occasion_required
    check (
        occasion is not null
        and btrim(occasion) <> ''
    )
    not valid;


-- Length validation
alter table public.clothing_items
    add constraint clothing_items_season_length
    check (
        season is null
        or char_length(season) <= 30
    )
    not valid;


alter table public.clothing_items
    add constraint clothing_items_formality_length
    check (
        formality is null
        or char_length(formality) <= 40
    )
    not valid;


alter table public.clothing_items
    add constraint clothing_items_occasion_length
    check (
        occasion is null
        or char_length(occasion) <= 60
    )
    not valid;


-- ------------------------------------------------------------
-- 5. updated_at trigger
-- ------------------------------------------------------------

create or replace function public.set_clothing_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


drop trigger if exists clothing_items_updated_at
on public.clothing_items;


create trigger clothing_items_updated_at
before update on public.clothing_items
for each row
execute function public.set_clothing_item_updated_at();


-- ------------------------------------------------------------
-- 6. Permissions
-- ------------------------------------------------------------

grant select, insert, update, delete
on public.clothing_items
to authenticated;


-- ------------------------------------------------------------
-- 7. Reload PostgREST schema cache
-- ------------------------------------------------------------

notify pgrst, 'reload schema';


commit;