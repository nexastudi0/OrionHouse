-- ORION HOME - CONFIGURACAO DO SUPABASE
-- Usuarios ja existentes no projeto:
-- CASA: orionhouse@gmail.com
-- RUA:  hummelgen17@gmail.com
-- RUA:  kaylaine.carol02@gmail.com

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('home','street')),
  created_at timestamptz not null default now()
);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity integer not null default 1 check (quantity > 0),
  category text not null default 'Outros',
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.shopping_items enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
drop policy if exists "Authenticated users read list" on public.shopping_items;
drop policy if exists "Home inserts items" on public.shopping_items;
drop policy if exists "Authenticated users update items" on public.shopping_items;
drop policy if exists "Home deletes items" on public.shopping_items;

create policy "Users read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);

create policy "Authenticated users read list"
on public.shopping_items for select
to authenticated
using (true);

create policy "Home inserts items"
on public.shopping_items for insert
to authenticated
with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'home')
);

create policy "Authenticated users update items"
on public.shopping_items for update
to authenticated
using (true)
with check (true);

create policy "Home deletes items"
on public.shopping_items for delete
to authenticated
using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'home')
);

-- Perfis exatos dos usuarios mostrados no Authentication > Users.
insert into public.profiles (id, role) values
  ('e5a23a68-c7b8-4201-a219-59d602025ce3', 'home'),
  ('d28356f2-d3cd-4665-b78f-5dae911fd8c3', 'street'),
  ('244b80c7-9001-40ca-beea-6df5a171b07b', 'street')
on conflict (id) do update set role = excluded.role;

-- Realtime para sincronizar Casa e Rua instantaneamente.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_items'
  ) then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
end $$;
