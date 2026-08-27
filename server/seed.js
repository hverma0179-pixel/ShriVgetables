// Product names are intentionally tied to the vegetable or fruit shown in each local photograph.
const products = [
  ['अनानास', 'Pineapple', 'Fruits', 85, 'pineapple.jpg', 'Sweet, ripe pineapple with a fresh tropical flavour.', 'piece'],
  ['लाल शिमला मिर्च', 'Red Capsicum', 'Fruit vegetables', 95, 'red-capsicum.jpg', 'Crisp red bell pepper with a naturally sweet flavour.', 'kg'],
  ['ब्रोकोली', 'Broccoli', 'Leafy vegetables', 90, 'broccoli.jpg', 'Farm-fresh broccoli florets for stir-fries, soups and healthy meals.', 'bunch'],
  ['बैंगन', 'Brinjal', 'Fruit vegetables', 48, 'brinjal.jpg', 'Smooth, tender brinjal for bharta and curries.', 'kg'],
  ['नींबू', 'Lemon', 'Fruits', 75, 'lemon.jpg', 'Fresh juicy lemons for drinks, dressings and everyday cooking.', 'kg'],
  ['टमाटर', 'Tomato', 'Fruit vegetables', 42, 'tomato.jpg', 'Juicy ripe tomatoes for curries, salads and everyday cooking.', 'kg'],
  ['अदरक', 'Ginger', 'Roots', 120, 'ginger.jpg', 'Aromatic fresh ginger for chai, curries and home cooking.', 'kg'],
  ['आलू', 'Potato', 'Roots', 32, 'potato.jpg', 'Firm, fresh potatoes for everyday curries, roasting and family meals.', 'kg'],
  ['गाजर', 'Carrot', 'Roots', 55, 'carrot.jpg', 'Sweet, crisp carrots with a natural crunch.', 'kg'],
  ['खीरा', 'Cucumber', 'Fruit vegetables', 40, 'cucumber.jpg', 'Cool, crisp cucumber for salads and raita.', 'kg'],
  ['बेबी खीरा', 'Baby Cucumber', 'Fruit vegetables', 55, 'baby-cucumber.jpg', 'Small, crisp baby cucumbers for salads, snacks and raita.', 'kg'],
  ['लाल स्विस चार्ड', 'Red Swiss Chard', 'Leafy vegetables', 60, 'red-swiss-chard.jpg', 'Fresh leafy red Swiss chard with tender green leaves and red stems.', 'bunch'],
  ['फूल गोभी', 'Cauliflower', 'Leafy vegetables', 55, 'cauliflower.jpg', 'Fresh dense cauliflower for family meals.', 'piece'],
  ['पालक', 'Spinach', 'Leafy vegetables', 28, 'spinach.jpg', 'Tender green spinach, freshly picked.', 'bunch'],
  ['लाल प्याज', 'Red Onion', 'Roots', 38, 'red-onion.jpg', 'Fresh red onions with a crisp texture and robust kitchen flavour.', 'kg']
];

export const seedProducts = () => products.map(([hindiName, name, category, price, photo, description, unit], index) => ({
  id: index + 1,
  hindiName,
  name,
  category,
  price,
  imageUrl: '/products/vegetables/' + photo,
  stock: 12 + (index * 7) % 36,
  unit,
  featured: index < 6,
  description
}));