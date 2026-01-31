/**
 * Card Creator Utilities
 * Functions for creating UI card elements
 */

/**
 * Create a simple card element
 * @param {string} title - Card title
 * @param {string} main - Main content (e.g., bonus value)
 * @param {string} sub - Sub content (optional)
 * @param {Function} onClick - Click handler
 * @returns {HTMLElement} Card element
 */
function createCard(title, main, sub, onClick) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <strong>${title}</strong><br>
    <span class="bonus">${main}</span><br>
    ${sub ? `<span class="bonus">${sub}</span>` : ''}
  `;
  card.addEventListener('click', onClick);
  return card;
}

/**
 * Create a spell card element
 * @param {object} spell - Spell data object
 * @param {number} index - Spell index
 * @returns {HTMLElement} Spell card element
 */
function createSpellCard(spell, index) {
  const card = document.createElement('div');
  card.className = 'spell-card';

  const header = document.createElement('div');
  header.className = 'spell-header';

  // Build tags string
  let tags = '';
  if (spell.concentration) {
    tags += '<span class="concentration-tag">🧠 Concentration</span>';
  }
  if (spell.ritual) {
    tags += '<span class="ritual-tag">📖 Ritual</span>';
  }

  header.innerHTML = `
    <div>
      <span style="font-weight: bold;">${spell.name}</span>
      ${spell.level ? `<span style="margin-left: 10px; color: var(--text-secondary);">Level ${spell.level}</span>` : ''}
      ${tags}
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="cast-btn" data-spell-index="${index}">✨ Cast</button>
      <button class="toggle-btn">▼ Details</button>
    </div>
  `;

  const desc = document.createElement('div');
  desc.className = 'spell-description';
  desc.id = `spell-desc-${index}`;
  desc.innerHTML = `
    ${spell.castingTime ? `<div><strong>Casting Time:</strong> ${spell.castingTime}</div>` : ''}
    ${spell.range ? `<div><strong>Range:</strong> ${spell.range}</div>` : ''}
    ${spell.components ? `<div><strong>Components:</strong> ${spell.components}</div>` : ''}
    ${spell.duration ? `<div><strong>Duration:</strong> ${spell.duration}</div>` : ''}
    ${spell.school ? `<div><strong>School:</strong> ${spell.school}</div>` : ''}
    ${spell.source ? `<div><strong>Source:</strong> ${spell.source}</div>` : ''}
    ${spell.description ? `<div style="margin-top: 10px;">${spell.description}</div>` : ''}
  `;

  card.appendChild(header);
  card.appendChild(desc);

  // Toggle description visibility
  const toggleBtn = header.querySelector('.toggle-btn');
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    desc.classList.toggle('expanded');
    toggleBtn.textContent = desc.classList.contains('expanded') ? '▲ Hide' : '▼ Details';
  });

  return card;
}

/**
 * Create an action card element
 * @param {object} action - Action data object
 * @param {number} index - Action index
 * @returns {HTMLElement} Action card element
 */
function createActionCard(action, index) {
  const card = document.createElement('div');
  card.className = 'action-card';

  const header = document.createElement('div');
  header.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <strong>${action.name || 'Action'}</strong>
        ${action.uses ? `<span class="uses-badge">${action.uses} uses</span>` : ''}
      </div>
      <div class="action-buttons" style="display: flex; gap: 8px;">
        ${action.attackRoll ? `<button class="attack-btn" data-action-index="${index}">⚔️ Attack</button>` : ''}
        ${action.damage ? `<button class="damage-btn" data-action-index="${index}">💥 Damage</button>` : ''}
        ${action.uses ? `<button class="use-btn" data-action-index="${index}">✨ Use</button>` : ''}
        <button class="toggle-btn">▼</button>
      </div>
    </div>
  `;

  const desc = document.createElement('div');
  desc.className = 'action-description';
  desc.id = `action-desc-${index}`;
  if (action.description) {
    desc.innerHTML = `<div>${action.description}</div>`;
  }

  card.appendChild(header);
  card.appendChild(desc);

  // Toggle description visibility
  const toggleBtn = header.querySelector('.toggle-btn');
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    desc.classList.toggle('expanded');
    toggleBtn.textContent = desc.classList.contains('expanded') ? '▲' : '▼';
  });

  return card;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createCard, createSpellCard, createActionCard };
}

// Make available globally for popup-sheet.js
if (typeof window !== 'undefined') {
  window.CardCreator = { createCard, createSpellCard, createActionCard };
}
