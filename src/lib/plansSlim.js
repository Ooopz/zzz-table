// src/lib/plansSlim.js —— plans 载荷瘦身（server /api/data 与 publish-release 静态构建共用；改剥离集只改这一处）
// desc 是大段攻略正文，占体积一多半，剥离后 /api/data 负载显著变小；skills 是另一大头。
export const PLAN_DROP_FIELDS = ['desc', 'skills'];

export function slimPlans(plans) {
  const out = {};
  for (const [id, v] of Object.entries(plans || {})) {
    out[id] = {
      ...v,
      plans: (v.plans || []).map((p) => {
        const q = { ...p };
        for (const f of PLAN_DROP_FIELDS) delete q[f];
        return q;
      }),
    };
  }
  return out;
}
