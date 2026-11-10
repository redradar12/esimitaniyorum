'use strict';

const UNO_COLORS = ['red', 'yellow', 'green', 'blue'];

const UNO_COLOR_NAMES = {
  red: 'Kırmızı',
  yellow: 'Sarı',
  green: 'Yeşil',
  blue: 'Mavi',
  wild: 'Joker',
};

const UNO_ACTION_NAMES = {
  skip: 'Pas',
  reverse: 'Yön',
  draw2: '+2',
  wild: 'Joker',
  wild4: '+4 Joker',
};

function shuffleUno(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createUnoDeck() {
  let id = 0;
  const cards = [];
  const add = (color, value, copies) => {
    for (let i = 0; i < copies; i += 1) {
      cards.push({ id: `u${id++}`, color, value });
    }
  };

  for (const color of UNO_COLORS) {
    add(color, '0', 1);
    for (let value = 1; value <= 9; value += 1) add(color, String(value), 2);
    add(color, 'skip', 2);
    add(color, 'reverse', 2);
    add(color, 'draw2', 2);
  }
  add('wild', 'wild', 4);
  add('wild', 'wild4', 4);
  return shuffleUno(cards);
}

function isUnoPlayable(card, top, currentColor, hand = []) {
  if (!card || !top) return false;
  if (card.color === 'wild') {
    if (card.value === 'wild4') {
      return !hand.some((item) => item.id !== card.id && item.color === currentColor);
    }
    return true;
  }
  return card.color === currentColor || card.value === top.value;
}

function unoCardLabel(card) {
  if (!card) return '';
  if (card.color === 'wild') return UNO_ACTION_NAMES[card.value] || 'Joker';
  const color = UNO_COLOR_NAMES[card.color] || card.color;
  const value = UNO_ACTION_NAMES[card.value] || card.value;
  return `${color} ${value}`;
}

module.exports = {
  UNO_COLORS,
  UNO_COLOR_NAMES,
  UNO_ACTION_NAMES,
  createUnoDeck,
  isUnoPlayable,
  unoCardLabel,
  shuffleUno,
};
