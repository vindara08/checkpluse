-- Evolve clothing_items in place. Existing wardrobe and outfit IDs remain unchanged.
-- Review the deployed schema before applying; this migration preserves notes verbatim.

begin;

alter table public.clothing_items
  rename column color to dominant_color;

alter table public.clothing_items
  rename column subcategory to clothing_type;

alter table public.clothing_items
  add column secondary_color text check (secondary_color is null or char_length(secondary_color) <= 40),
  add column color_family text check (color_family is null or char_length(color_family) <= 40),
  add column brightness text check (brightness is null or char_length(brightness) <= 30),
  add column pattern text check (pattern is null or char_length(pattern) <= 40),
  add column pattern_confidence double precision check (
    pattern_confidence is null or pattern_confidence between 0 and 1
  ),
  add column detection_confidence double precision check (
    detection_confidence is null or detection_confidence between 0 and 1
  ),
  add column formality text not null default '' check (char_length(formality) <= 40),
  add column occasion text not null default '' check (char_length(occasion) <= 60),
  add column updated_at timestamptz not null default now();

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

drop trigger if exists clothing_items_updated_at on public.clothing_items;
create trigger clothing_items_updated_at
  before update on public.clothing_items
  for each row execute function public.set_clothing_item_updated_at();

grant select, insert, update, delete on public.clothing_items to authenticated;
notify pgrst, 'reload schema';

commit;

-- Roll back only before application code depends on the new columns.
-- Drop the trigger/function and added columns, then rename dominant_color to color
-- and clothing_type to subcategory. Existing values and outfit relationships remain
-- intact, but new structured AI metadata will be discarded by that rollback.
