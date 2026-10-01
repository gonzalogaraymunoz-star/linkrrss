alter table public.link_rrss_operation_plans
  add column if not exists operator_user_id uuid references auth.users(id) on delete set null;

alter table public.link_rrss_operation_tasks
  add column if not exists assigned_to_user_id uuid references auth.users(id) on delete set null;

create index if not exists link_rrss_operation_plans_operator_user_idx
  on public.link_rrss_operation_plans (operator_user_id);

create index if not exists link_rrss_operation_tasks_assigned_user_idx
  on public.link_rrss_operation_tasks (assigned_to_user_id);
