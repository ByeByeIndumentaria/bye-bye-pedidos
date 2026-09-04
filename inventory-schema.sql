create table if not exists public.inventory_products (
  product_id integer primary key,
  code text,
  name text not null,
  season text not null,
  tracking_mode text not null check (tracking_mode in ('total', 'color')),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_stock (
  product_id integer not null references public.inventory_products(product_id) on delete cascade,
  variant text not null default 'TOTAL',
  initial_quantity integer not null check (initial_quantity >= 0),
  quantity integer not null check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, variant)
);

create table if not exists public.inventory_movements (
  id bigint generated always as identity primary key,
  product_id integer not null references public.inventory_products(product_id),
  variant text not null,
  quantity_delta integer not null,
  order_id uuid,
  order_number text,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.inventory_products enable row level security;
alter table public.inventory_stock enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "inventory products readable" on public.inventory_products;
create policy "inventory products readable" on public.inventory_products for select to anon, authenticated using (true);
drop policy if exists "inventory stock readable" on public.inventory_stock;
create policy "inventory stock readable" on public.inventory_stock for select to anon, authenticated using (true);
drop policy if exists "inventory movements readable" on public.inventory_movements;
create policy "inventory movements readable" on public.inventory_movements for select to anon, authenticated using (true);

create or replace function public.order_affects_stock(status text)
returns boolean language sql immutable as $$
  select coalesce(status, '') not in ('', 'Borrador', 'Cancelado');
$$;

create or replace function public.save_order_with_inventory(p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (p_order->>'id')::uuid;
  v_old jsonb;
  v_allocation jsonb;
  v_available integer;
  v_needed integer;
  v_product integer;
  v_variant text;
  v_old_affects boolean := false;
  v_new_affects boolean := public.order_affects_stock(p_order->>'estado');
begin
  select payload into v_old from public.orders where id = v_id for update;
  v_old_affects := v_old is not null and public.order_affects_stock(v_old->>'estado');

  if v_old_affects then
    for v_allocation in select value from jsonb_array_elements(coalesce(v_old->'stockAllocations', '[]'::jsonb)) loop
      v_product := (v_allocation->>'productId')::integer;
      v_variant := v_allocation->>'variant';
      v_needed := (v_allocation->>'quantity')::integer;
      update public.inventory_stock
         set quantity = quantity + v_needed, updated_at = now()
       where product_id = v_product and variant = v_variant;
      insert into public.inventory_movements(product_id, variant, quantity_delta, order_id, order_number, reason)
      values (v_product, v_variant, v_needed, v_id, p_order->>'numero', 'Ajuste o devolución de pedido');
    end loop;
  end if;

  if v_new_affects then
    for v_allocation in select value from jsonb_array_elements(coalesce(p_order->'stockAllocations', '[]'::jsonb)) loop
      v_product := (v_allocation->>'productId')::integer;
      v_variant := v_allocation->>'variant';
      v_needed := (v_allocation->>'quantity')::integer;
      select quantity into v_available
        from public.inventory_stock
       where product_id = v_product and variant = v_variant
       for update;
      if v_available is null then
        raise exception 'No hay stock configurado para el producto % (%).', v_product, v_variant using errcode = 'P0001';
      end if;
      if v_needed > v_available then
        raise exception 'Stock insuficiente para %: disponibles %, solicitadas %.', v_variant, v_available, v_needed using errcode = 'P0001';
      end if;
      update public.inventory_stock
         set quantity = quantity - v_needed, updated_at = now()
       where product_id = v_product and variant = v_variant;
      insert into public.inventory_movements(product_id, variant, quantity_delta, order_id, order_number, reason)
      values (v_product, v_variant, -v_needed, v_id, p_order->>'numero', 'Pedido confirmado');
    end loop;
  end if;

  insert into public.orders(id, number, customer, status, order_date, payload, updated_at)
  values (v_id, coalesce(nullif(p_order->>'numero', ''), 'SIN-NUMERO-' || v_id), coalesce(p_order->>'cliente', ''), coalesce(p_order->>'estado', 'Borrador'), null, p_order, now())
  on conflict (id) do update set number=excluded.number, customer=excluded.customer, status=excluded.status, payload=excluded.payload, updated_at=now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_order_with_inventory(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_allocation jsonb;
begin
  select payload into v_old from public.orders where id = p_order_id for update;
  if v_old is null then return jsonb_build_object('ok', true); end if;
  if public.order_affects_stock(v_old->>'estado') then
    for v_allocation in select value from jsonb_array_elements(coalesce(v_old->'stockAllocations', '[]'::jsonb)) loop
      update public.inventory_stock set quantity = quantity + (v_allocation->>'quantity')::integer, updated_at = now()
       where product_id = (v_allocation->>'productId')::integer and variant = v_allocation->>'variant';
      insert into public.inventory_movements(product_id, variant, quantity_delta, order_id, order_number, reason)
      values ((v_allocation->>'productId')::integer, v_allocation->>'variant', (v_allocation->>'quantity')::integer, p_order_id, v_old->>'numero', 'Pedido eliminado');
    end loop;
  end if;
  delete from public.orders where id = p_order_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.adjust_inventory(p_product_id integer, p_variant text, p_new_quantity integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_old integer;
begin
  if p_new_quantity < 0 then raise exception 'La cantidad no puede ser negativa.'; end if;
  select quantity into v_old from public.inventory_stock where product_id=p_product_id and variant=p_variant for update;
  if v_old is null then raise exception 'No existe esa variante de stock.'; end if;
  update public.inventory_stock set quantity=p_new_quantity, updated_at=now() where product_id=p_product_id and variant=p_variant;
  insert into public.inventory_movements(product_id, variant, quantity_delta, reason)
  values (p_product_id, p_variant, p_new_quantity-v_old, coalesce(nullif(p_reason,''), 'Corrección manual'));
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.save_order_with_inventory(jsonb) to anon, authenticated;
grant execute on function public.delete_order_with_inventory(uuid) to anon, authenticated;
grant execute on function public.adjust_inventory(integer, text, integer, text) to anon, authenticated;
