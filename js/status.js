/** Sheet status → 顯示文案與樣式 class（對齊需求 wireframe） */
export function matchStatusMeta(status) {
  var s = String(status || '').toLowerCase();
  if (s === 'postponed') {
    return { label: '延期', dotClass: 'dot-postponed', rowClass: 'status-postponed' };
  }
  if (s === 'tentative' || s === 'unconfirmed') {
    return { label: '未確認', dotClass: 'dot-tentative', rowClass: 'status-tentative' };
  }
  if (s === 'cancelled' || s === 'canceled') {
    return { label: '取消', dotClass: 'dot-cancelled', rowClass: 'status-cancelled' };
  }
  // scheduled 等預設對應 wireframe「已確認」綠燈（用語可依產品再調）
  return { label: '已確認', dotClass: 'dot-confirmed', rowClass: 'status-confirmed' };
}
