create table if not exists public.live_categories (
  name text primary key,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.live_categories enable row level security;

create policy "Public can read live categories"
on public.live_categories for select using (true);

create policy "Public can create live categories"
on public.live_categories for insert with check (true);

create policy "Public can update live categories"
on public.live_categories for update using (true) with check (true);

create policy "Public can delete live categories"
on public.live_categories for delete using (true);

insert into public.live_categories (name, sort_order)
values
  ('All Star', 0), ('Nails', 10), ('Boo Faves', 20), ('Jes Faves', 30),
  ('Mom Faves', 40), ('Pokemon Cards', 50), ('Clothing', 60), ('Beauty', 70),
  ('Stationery', 80), ('Home Goods', 90), ('Pet', 100), ('Hair', 110),
  ('Cosmetics', 120), ('Tech', 130), ('Kitchen', 140), ('Skincare', 150),
  ('Food', 160), ('Handbags & Wallets', 170), ('Plants', 180),
  ('Official Company', 190), ('Car', 200), ('Jewelry', 210), ('Kids', 220)
on conflict (name) do nothing;
