function formatCountLabel(value, forms) {
  const count = toSafeCount(value);
  const [one, few, many] = Array.isArray(forms) ? forms : [];
  const word = selectRussianPluralForm(count, one, few, many);
  return `${count} ${word}`.trim();
}

function selectRussianPluralForm(count, one = '', few = '', many = '') {
  const absolute = Math.abs(toSafeCount(count));
  const mod100 = absolute % 100;
  const mod10 = absolute % 10;

  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }

  if (mod10 === 1) {
    return one;
  }

  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }

  return many;
}

function toSafeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

module.exports = {
  formatCountLabel,
  selectRussianPluralForm
};
