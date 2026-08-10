function normalizeRole(value) {
  const role = String(value || '').trim();
  if (!role) return 'Роль не указана';
  const normalized = role.toLowerCase().replace(/[^a-zа-яё]/g, '');
  const roleMap = {
    admin: 'Администратор',
    administrator: 'Администратор',
    operator: 'Оператор',
    agronom: 'Агроном',
    agronomist: 'Агроном',
    technologist: 'Технолог',
    technician: 'Техник',
    greenhouse: 'Сотрудник теплицы',
    greenhouseworker: 'Сотрудник теплицы',
    greenhouseoperator: 'Оператор теплицы',
    greenhousemanager: 'Менеджер теплицы',
    lab: 'Лаборант',
    laboratory: 'Лаборант',
    laboratorian: 'Лаборант',
    researcher: 'Исследователь',
    manager: 'Менеджер',
    supervisor: 'Руководитель'
  };
  return roleMap[normalized] || role;
}

module.exports = {
  normalizeRole
};
