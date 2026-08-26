do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lives'
      and policyname = 'Public can delete lives'
  ) then
    alter policy "Public can delete lives"
    on public.lives
    using (true);
  end if;
end $$;

alter table public.lives
drop column if exists is_default;
