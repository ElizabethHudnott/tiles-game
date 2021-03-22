import Components from './components.js';
import Particle from './particle.js';
import timer from './timer.js';

const context = document.getElementById('canvas').getContext('2d');
const audioContext = new AudioContext();
const sounds = new Map();

const CellType = Object.freeze({
	EMPTY: 0,
	BLANK: 1,
	COLOR: 2,
});

const COLORS = [
	[  0,   0, 40],		// Gray
	[ 15, 100, 60],		// Red
	[105, 100, 46],		// Green
	[225, 100, 62],		// Blue
	[ 45, 100, 60],		// Yellow
	[195, 100, 60],		// Cyan
	[315, 100, 72],		// Pink
	[280, 100, 55],		// Purple
];

const DARKEN = [27, 40, 28, 40, 30, 40, 45, 37];

const MAX_VISIBLE_DEPTH = 4;

const TIME_PER_FRAME = 1000 / 60;
const FALL_TIME = 150;
const FADE_TIME = 150;
const MIN_PARTICLE_SIZE = 10;
const PARTICLE_SPEED = 18 / TIME_PER_FRAME;

let parentElement = document.body;
let gravity;
let gridWidth, gridHeight, gridDepth, numColors;
let grid, startColumn;
let minShapeSize, maxShapeSize, modalShapeSize, shapeSizeRange;
let minRunLength = parseInt(document.getElementById('run-length').value) || 2;
let blankProportion, colorOverBlank, dropProbability;
let cellSize, boxSize, cornerSize, pxOffset;
let cellCapacity, totalCapacity, blanksPlaced, colorsPlaced;
let random;
let topShapes, bombNeeded;
let bombsUsed;
let animLengthDown, animLengthRight, animFade, maxAnimLength, animStartTime;
let explosionVectors;
const particles = [];

function loadSound(label, url) {
	return fetch(url, {
		credentials: 'include',
		mode: 'no-cors',
	})
	.then(function (response) {
		if (!response.ok) {
			throw new Error(`${url}: HTTP ${response.status} - ${response.statusText}`);
		}
		return response.arrayBuffer();
	})
	.then(function (arrayBuffer) {
		return audioContext.decodeAudioData(arrayBuffer);
	})
	.then(function (audioBuffer) {
		sounds.set(label, audioBuffer);
	});
}

loadSound('laser', '../sound/laser.mp3');
loadSound('smash', '../sound/smash.mp3');

function panSound(label, pan) {
	const buffer = sounds.get(label);
	if (buffer === undefined) {
		return;
	}
	const panner = audioContext.createStereoPanner();
	panner.pan.value = pan;
	panner.connect(audioContext.destination);
	const source = audioContext.createBufferSource();
	source.buffer = buffer;
	source.connect(panner);
	source.start();
}

function playSound(label) {
	const buffer = sounds.get(label);
	if (buffer === undefined) {
		return;
	}
	const source = audioContext.createBufferSource();
	source.buffer = buffer;
	source.connect(audioContext.destination);
	source.start();
}

const scrollbarSize = function () {
	// Creating invisible container
	const outer = document.createElement('div');
	outer.style.visibility = 'hidden';
	outer.style.overflow = 'scroll'; // forcing scrollbar to appear
	outer.style.msOverflowStyle = 'scrollbar'; // needed for WinJS apps
	document.body.appendChild(outer);

	// Creating inner element and placing it in the container
	const inner = document.createElement('div');
	outer.appendChild(inner);

	// Calculating difference between container's full width and the child width
	const scrollbarWidth = (outer.offsetWidth - inner.offsetWidth);

	// Removing temporary elements from the DOM
	outer.parentNode.removeChild(outer);

	return scrollbarWidth;
}();

globalThis.debugGrid = function () {
	let str = '';
	for (let j = gridHeight - 1; j >= 0; j--) {
		for (let i = 0; i < gridWidth; i++) {
			const content = grid[i][j];
			let spaces = 1;
			let countingEmpties = true;
			for (let k = gridDepth - 1; k >= 0; k--) {
				if (content[k] === CellType.EMPTY && countingEmpties) {
					spaces++;
				} else {
					str += content[k].toString();
					countingEmpties = false;
				}
			}
			str += ' '.repeat(spaces);
		}
		str += '\n';
	}
	console.log(str);
}

function noFade() {
	for (let i = 0; i < gridWidth; i++) {
		for (let j = 0; j < gridHeight; j++) {
			if (animFade[i][j]) {
				const content = grid[i][j]
				const depth = getDepth(content);
				content[depth - 1] = CellType.EMPTY;
				animFade[i][j] = false;
			}
		}
	}
}

function noBlocksMoving() {
	for (let i = 0; i < gridWidth; i++) {
		animLengthDown[i].fill(0);
	}
	animLengthRight.fill(0);
	maxAnimLength = 0;
}

function emptyGrid() {
	grid = new Array(gridWidth);
	cellCapacity = new Array(gridWidth);
	for (let i = 0; i < gridWidth; i++) {
		let row = new Array(gridHeight);
		grid[i] = row;
		cellCapacity[i] = new Array(gridHeight);
		cellCapacity[i].fill(gridDepth);
		for (let j = 0; j < gridHeight; j++) {
			const cell = new Array(gridDepth);
			row[j] = cell;
			cell.fill(CellType.EMPTY);
		}
	}
	totalCapacity = gridWidth * gridHeight * gridDepth;
	blanksPlaced = 0;
	colorsPlaced = 0;
	animLengthDown = new Array(gridWidth);
	animFade = new Array(gridWidth);
	for (let i = 0; i < gridWidth; i++) {
		let arr = new Array(gridHeight);
		arr.fill(0);
		animLengthDown[i] = arr;
		arr = new Array(gridHeight);
		arr.fill(false);
		animFade[i] = arr;
	}
	animLengthRight = new Array(gridWidth);
	animLengthRight.fill(0);
	maxAnimLength = 0;
}

/** Gets the number of tiles on a cell during play.
*/
function getDepth(content) {
	let depth = gridDepth;
	while (depth > 0 && content[depth - 1] === CellType.EMPTY) {
		depth--;
	}
	return depth;
}

function getTopColor(x, y) {
	const content = grid[x][y];
	let depth = gridDepth - 1;
	do {
		let color = content[depth];
		if (color !== CellType.EMPTY) {
			return color;
		}
		depth--;
	} while (depth >= 0);
	return CellType.EMPTY;
}

/** Gets the number of tiles on a cell during level construction. */
function getBuiltDepth(x, y) {
	return gridDepth - cellCapacity[x][y];
}

/** The depth parameter is backwards in this function. Higher numbers are underneath.
 */
function getColor(i, depth, opacity) {
	if (depth > 1) {
		const gray = 152 - (depth - 1) * 32;
		return `rgb(${gray}, ${gray}, ${gray})`;
	} else if (depth === 0) {
		const values = COLORS[i - 1];
		return `hsla(${values[0]}, ${values[1]}%, ${values[2]}%, ${opacity})`;
	} else {
		const values = COLORS[i - 1];
		// Darken
		const brightness = opacity * DARKEN[i - 1] + (1 - opacity) * values[2];
		return `hsla(${values[0]}, ${values[1]}%, ${brightness}%, 1)`;
	}
}

function chooseCell() {
	let x = Math.trunc(random.next() * gridWidth);
	let y = Math.trunc(random.next() * gridHeight);
	let capacity = cellCapacity[x][y];
	while (capacity === 0) {
		// Find the nearest space.
		x++;
		if (x === gridWidth) {
			x = 0;
			y++;
			if (y === gridHeight) {
				y = 0;
			}
		}
		capacity = cellCapacity[x][y];
	}
	while (y > 0 && cellCapacity[x][y - 1] === gridDepth) {
		// Don't place blocks in mid-air.
		y--;
	}
	if (y === 0) {
		while (x < startColumn && cellCapacity[x + 1][0] === gridDepth) {
			x++;
		}
		while (x > startColumn && cellCapacity[x - 1][0] === gridDepth) {
			x--;
		}
	}
	return [x, y];
}

function chooseShapeSize() {
	if (shapeSizeRange === 0) {
		return minShapeSize;
	}
	const p = random.next();
	const modeMinusMin = modalShapeSize - minShapeSize;
	let x = minShapeSize + Math.sqrt(modeMinusMin * shapeSizeRange * p);
	if (x > modalShapeSize) {
		x =  maxShapeSize - Math.sqrt(shapeSizeRange * (maxShapeSize - modalShapeSize) * (1 - p));
	}
	return Math.round(x);
}

/** Returns whether or not a shape can be expanded into a particular cell and if not then
 *	which cell would cause a merger with another shape.
 */
function canExpand(x, y, shapeSet, color) {
	if (cellCapacity[x][y] === 0) {
		return [false, undefined];
	}
	if (shapeSet.has(`${x},${y}`)) {
		return [false, undefined];
	}
	if (y > 0 && cellCapacity[x][y - 1] === gridDepth && !shapeSet.has(`${x},${y - 1}`)) {
		// Can't be floating mid air.
		return [false, undefined];
	}
	let depth;
	if (x > 0) {
		depth = getBuiltDepth(x - 1, y);
		if (grid[x - 1][y][depth - 1] === color) {
			return [false, [x - 1, y]];
		}
	}
	if (x < gridWidth - 1) {
		depth = getBuiltDepth(x + 1, y);
		if (grid[x + 1][y][depth - 1] === color) {
			return [false, [x + 1, y]];
		}
	}
	if (y > 0) {
		depth = getBuiltDepth(x, y - 1);
		if (grid[x][y - 1][depth - 1] === color) {
			return [false, [x, y - 1]];
		}
	}
	if (y < gridHeight - 1) {
		depth = getBuiltDepth(x, y + 1);
		if (grid[x][y + 1][depth - 1] === color) {
			return [false, [x, y + 1]];
		}
	}
	return [true, undefined];
}

function shiftUp(x, y) {
	for (let j = gridHeight - 2; j >= y; j--) {
		grid[x][j + 1] = grid[x][j];
		cellCapacity[x][j + 1] = cellCapacity[x][j];
	}

	const content = new Array(gridDepth);
	content.fill(CellType.EMPTY);
	grid[x][y] = content;
	cellCapacity[x][y] = gridDepth;

	const topCellContent = grid[x][gridHeight - 1];
	if (topCellContent[0] === CellType.BLANK) {
		if (colorOverBlank) {
			topCellContent.shift();
			topCellContent[gridDepth - 1] = CellType.EMPTY;
			cellCapacity[x][gridHeight - 1]++;
			totalCapacity++;
		} else {
			topCellContent[0] = CellType.EMPTY;
			cellCapacity[x][gridHeight - 1] = gridDepth;
			totalCapacity += gridDepth;
		}
		blanksPlaced--;
	}
}

function canPlaceBlank(x, y) {
	if (y === gridHeight - 1 || grid[x][y][0] === CellType.BLANK) {
		return false;
	}
	const capacity = cellCapacity[x][y];
	const sufficentCapacity = colorOverBlank ? capacity > 0 : capacity === gridDepth;
	if (!sufficentCapacity) {
		return false;
	}
	if (y === 0) {
		for (let i = 0; i < gridWidth; i++) {
			if (grid[i][0][0] !== CellType.BLANK && i !== x) {
				return true;
			}
		}
		return false;
	} else {
		return true;
	}
}

function makeShape() {
	let [x, y] = chooseCell();
	const numSquares = gridWidth * gridHeight;
	const numUnused = numSquares - colorsPlaced - blanksPlaced;
	const blankProbability = (blankProportion * numSquares - blanksPlaced) / numUnused;
	if (random.next() < blankProbability && canPlaceBlank(x, y)) {
		if (colorOverBlank) {
			grid[x][y] = [CellType.BLANK].concat(grid[x][y].slice(0, gridDepth - 1));
			cellCapacity[x][y]--;
			totalCapacity--;
		} else {
			grid[x][y][0] = CellType.BLANK;
			cellCapacity[x][y] = 0;
			totalCapacity -= gridDepth;
		}
		blanksPlaced++;
		return true;
	}

	let shapeSet = new Set();
	shapeSet.add(`${x},${y}`);

	const possibleColors = new Set();
	for (let i = 0; i < numColors; i++) {
		possibleColors.add(i + CellType.COLOR);
	}
	if (x > 0) {
		const depth = getBuiltDepth(x - 1, y);
		if (depth > 0) {
			possibleColors.delete(grid[x - 1][y][depth - 1]);
		}
	}
	if (x < gridWidth - 1) {
		const depth = getBuiltDepth(x + 1, y);
		if (depth > 0) {
			possibleColors.delete(grid[x + 1][y][depth - 1]);
		}
	}
	if (y > 0) {
		const depth = getBuiltDepth(x, y - 1);
		if (depth > 0) {
			possibleColors.delete(grid[x][y - 1][depth - 1]);
		}
	}
	if (y < gridHeight - 1) {
		const depth = getBuiltDepth(x, y + 1);
		if (depth > 0) {
			possibleColors.delete(grid[x][y + 1][depth - 1]);
		}
	}

	let color;
	if (possibleColors.size > 0) {
		const colorIndex = Math.trunc(random.next() * possibleColors.size);
		let i = 0;
		for (let value of possibleColors.values()) {
			if (colorIndex === i) {
				color = value;
				break;
			}
			i++;
		}
	} else {
		// TODO Decide if and how to merge with an existing shape
		return false;
	}

	const expandable = new Set();
	const highest = new Map();
	highest.set(x, y);
	const targetSize = chooseShapeSize();

	do {
		if (x > 0) {
			const attempt = canExpand(x - 1, y, shapeSet, color);
			if (attempt[0]) {
				expandable.add(`E,${x - 1},${y}`);
			}
		}
		if (x < gridWidth - 1) {
			const attempt = canExpand(x + 1, y, shapeSet, color);
			if (attempt[0]) {
				expandable.add(`E,${x + 1},${y}`);
			}
		}
		if (y > 0) {
			const attempt = canExpand(x, y - 1, shapeSet, color);
			if (attempt[0]) {
				expandable.add(`E,${x},${y - 1}`);
			}
		}
		if (y < gridHeight - 1) {
			const attempt = canExpand(x, y + 1, shapeSet, color);
			if (attempt[0]) {
				expandable.add(`E,${x},${y + 1}`);
			}
		}
		if (expandable.size > 0) {
			const index = Math.trunc(random.next() * expandable.size);
			let i = 0;
			for (let value of expandable.values()) {
				if (index === i) {
					const params = value.split(',', 3);
					x = parseInt(params[1]);
					y = parseInt(params[2]);
					expandable.delete(value);
					shapeSet.add(`${x},${y}`);
					const highestInColumn = highest.get(x);
					if (highestInColumn === undefined || y > highestInColumn) {
						highest.set(x, y);
					}
					break;
				}
				i++;
			}
		} else {
			break;
		}

	} while (shapeSet.size < targetSize);

	if (shapeSet.size < minRunLength) {
		return false;
	}

	for (let [x, y] of highest.entries()) {
		const canShiftUp =
			cellCapacity[x][y] !== gridDepth &&
			grid[x][gridHeight - 1][0] === CellType.EMPTY;

		if (canShiftUp && random.next() <= dropProbability) {
			shiftUp(x, y);
		}
	}

	for (let coordStr of shapeSet.values()) {
		const coords = coordStr.split(',', 2);
		x = parseInt(coords[0]);
		y = parseInt(coords[1]);
		const depth = getBuiltDepth(x, y);
		grid[x][y][depth] = color;
		cellCapacity[x][y]--;
		if (depth === 0) {
			colorsPlaced++;
		}
	}
	totalCapacity -= shapeSet.size;
	return true;
}

function addShape() {
	let attempts = 0;
	let success;
	do {
		success = makeShape();
		attempts++;
	} while (!success && attempts < 1000);
	return success;
}

function resizeCanvas() {
	pxOffset = gridDepth <= 3 ? 4 : 3;
	const totalOffset = (Math.max(gridDepth - 1, 0) + 1) * pxOffset;

	cellSize = Math.min(
		Math.trunc((parentElement.clientWidth - scrollbarSize) / gridWidth),
		Math.trunc((window.innerHeight - scrollbarSize) / gridHeight),
		72 + totalOffset
	);
	boxSize = cellSize - totalOffset;
	cornerSize = Math.round(boxSize * 0.08);

	gravity = 2 * cellSize / (FALL_TIME * FALL_TIME);

	const numDivisions = Math.max(Math.trunc(boxSize / MIN_PARTICLE_SIZE), 2);
	const particleSize = boxSize / numDivisions;
	explosionVectors = new Array(numDivisions);
	for (let i = 0; i < numDivisions; i++) {
		explosionVectors[i] = new Array(numDivisions);
		for (let j = 0; j < numDivisions; j++) {
			const centreX = (i + 0.5 - numDivisions / 2) * particleSize;
			const centreY = (j + 0.5 - numDivisions / 2) * particleSize;
			const speed = Math.hypot(centreX, centreY) / Math.SQRT2 * PARTICLE_SPEED;
			const angle = Math.atan2(centreY, centreX);
			const velocityX = speed * Math.cos(angle);
			const velocityY = -speed * Math.sin(angle);
			explosionVectors[i][j] = [velocityX, velocityY];
		}
	}

	const canvas = context.canvas;
	canvas.width = cellSize * gridWidth;
	canvas.height = cellSize * gridHeight;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
}

function drawCell(i, j, xOffset, yOffset, opacity) {
	const content = grid[i][j];
	const depth = getDepth(content);

	const cellLeft = i * cellSize + xOffset;
	const cellTop = (gridHeight - 1 - j) * cellSize + yOffset;
	const startDepth = Math.max(0, depth - MAX_VISIBLE_DEPTH);
	let left, right, top, bottom;

	let zHeight = Math.min(gridDepth, MAX_VISIBLE_DEPTH) - 1;
	for (let k = startDepth; k < depth; k++) {
		left = cellLeft + pxOffset * zHeight;
		right = Math.min(left + boxSize, cellLeft + cellSize);
		left = Math.max(left, cellLeft);
		if (left >= right) {
			continue;
		}

		top = cellTop + pxOffset * zHeight;
		bottom = top + boxSize;
		top = Math.max(top, cellTop);
		if (top >= bottom) {
			continue;
		}
		context.fillStyle = getColor(content[k], depth - k - 1, opacity);
		drawTile(left, right, top, bottom);
		zHeight--;
	}
	const numLayers = opacity > 0.5 ? depth : depth - 1;
	if (numLayers > 0 && content[numLayers - 1] !== CellType.BLANK) {
		context.fillStyle = '#f4f4f4';
		const textOffset = opacity === 1 ? 0 : pxOffset * (1 - opacity);
		context.fillText(numLayers, (left + right) / 2 + textOffset, (top + bottom) / 2 + textOffset);
	}
}

function drawTile(left, right, top, bottom) {
	context.beginPath();
	context.moveTo(left + cornerSize, top);
	context.lineTo(right - cornerSize, top);
	context.arcTo(right, top, right, top + cornerSize, cornerSize);
	context.lineTo(right, bottom - cornerSize);
	context.arcTo(right, bottom, right - cornerSize, bottom, cornerSize);
	context.lineTo(left + cornerSize, bottom);
	context.arcTo(left, bottom, left, bottom - cornerSize, cornerSize);
	context.lineTo(left, top + cornerSize);
	context.arcTo(left, top, left + cornerSize, top, cornerSize);
	context.fill();
}

function drawCanvas(animAmount = 0, opacity = 1) {
	const canvas = context.canvas;
	context.clearRect(0, 0, canvas.width, canvas.height);

	if (timer.paused) {
		context.font = '3rem "Emilys Candy", fantasy';
		context.fillStyle = 'Black';
		context.fillText('Paused', Math.trunc(canvas.width / 2), Math.trunc(canvas.height / 2));
		return;
	}

	context.font = '16px sans-serif';

	for (let i = 0; i < gridWidth; i++) {
		let rightShift = animLengthRight[i];
		if (rightShift > animAmount) {
			rightShift = animAmount;
		} else if (rightShift < -animAmount) {
			rightShift = -animAmount;
		}
		const xOffset = Math.round(rightShift * cellSize);
		for (let j = 0; j < gridHeight; j++) {
			const yOffset = Math.round(Math.min(animAmount, animLengthDown[i][j]) * cellSize);
			drawCell(i, j, xOffset, yOffset, animFade[i][j] ? opacity : 1);
		}
	}
}

function setBombNeeded(needed) {
	bombNeeded = needed;
	let cursor;
	if (needed) {
		cursor = 'url(img/bomb-32.webp) 11 20, auto';
	} else {
		cursor = 'auto';
	}
	context.canvas.style.cursor = cursor;
}

let newSeed = true;

function newGame() {
	setBombNeeded(false);
	bombsUsed = 0;
	showBombsUsed();

	gridWidth = parseInt(document.getElementById('grid-width').value);
	gridHeight = parseInt(document.getElementById('grid-height').value);
	gridDepth = parseInt(document.getElementById('grid-depth').value);
	numColors = parseInt(document.getElementById('num-colors').value);

	const minShapeSizeInput = document.getElementById('shape-size-min');
	const maxShapeSizeInput = document.getElementById('shape-size-max');
	const modalShapeSizeInput = document.getElementById('shape-size-mode');
	minRunLength = parseInt(document.getElementById('run-length').value);
	minShapeSize = parseInt(minShapeSizeInput.value);
	maxShapeSize = parseInt(maxShapeSizeInput.value);
	modalShapeSize = parseInt(modalShapeSizeInput.value);
	if (maxShapeSize < minShapeSize) {
		[minShapeSize, maxShapeSize] = [maxShapeSize, minShapeSize];
		minShapeSizeInput.value = minShapeSize;
		maxShapeSizeInput.value = maxShapeSize;
	}
	if (modalShapeSize < minShapeSize) {
		modalShapeSize = minShapeSize;
	} else if (modalShapeSize > maxShapeSize) {
		modalShapeSize = maxShapeSize;
	}
	modalShapeSizeInput.value = modalShapeSize;
	shapeSizeRange = maxShapeSize - minShapeSize;

	dropProbability = parseFloat(document.getElementById('drop-probability').value) / 100;
	blankProportion = parseFloat(document.getElementById('blank-percentage').value) / 100;
	colorOverBlank = document.getElementById('color-over-blank').checked;

	const seedInput = document.getElementById('random-seed');
	const seedStr = seedInput.value;
	if (!newSeed && /^\d{1,10}\n\d{1,10}\n\d{1,10}\n\d{1,10}$/.test(seedStr)) {
		random = new RandomNumberGenerator(seedStr);
	} else {
		random = new RandomNumberGenerator();
		seedInput.value = random.seed;
	}

	resizeCanvas();
	emptyGrid();
	startColumn = Math.trunc(random.next() * gridWidth);
	let success;
	do {
		success = addShape();
	} while (totalCapacity > 0 && success);
	timer.reset();
	timer.start();
	drawCanvas();
	findTopShapes();
}

newGame();

function showBombsUsed() {
	document.getElementById('bombs-used').innerHTML = bombsUsed;
}

function findTopShapes() {
	let bombNeeded = true;
	const toVisit = new Set();
	for (let i = 0; i < gridWidth; i++) {
		for (let j = 0; j < gridHeight; j++) {
			toVisit.add(`${i},${j}`);
		}
	}
	topShapes = [];
	for (let coordStr of toVisit.values()) {
		toVisit.delete(coordStr);
		let coords = coordStr.split(',', 2);
		let x = parseInt(coords[0]);
		let y = parseInt(coords[1]);
		const color = getTopColor(x, y);
		if (color >= CellType.COLOR) {
			const shape = new Set();
			topShapes.push(shape);
			const queue = new Set();
			queue.add(coordStr);
			for (coordStr of queue.values()) {
				shape.add(coordStr);
				queue.delete(coordStr);
				toVisit.delete(coordStr);
				coords = coordStr.split(',', 2);
				x = parseInt(coords[0]);
				y = parseInt(coords[1]);

				if (x > 0) {
					const leftColor = getTopColor(x - 1, y);
					coordStr = `${x - 1},${y}`;
					if (leftColor === color && toVisit.has(coordStr)) {
						queue.add(coordStr);
					}
				}
				if (x < gridWidth - 1) {
					const rightColor = getTopColor(x + 1, y);
					coordStr = `${x + 1},${y}`;
					if (rightColor === color && toVisit.has(coordStr)) {
						queue.add(coordStr);
					}
				}
				if (y > 0) {
					const belowColor = getTopColor(x, y - 1);
					coordStr = `${x},${y - 1}`;
					if (belowColor === color && toVisit.has(coordStr)) {
						queue.add(coordStr);
					}
				}
				if (y < gridHeight - 1) {
					const aboveColor = getTopColor(x, y + 1);
					coordStr = `${x},${y + 1}`;
					if (aboveColor === color && toVisit.has(coordStr)) {
						queue.add(coordStr);
					}
				}
			}
			bombNeeded = bombNeeded && shape.size < minRunLength;
		}
	}
	if (topShapes.length === 0) {
		timer.stop();
		setBombNeeded(false);
	} else {
		setBombNeeded(bombNeeded);
	}
}

function animate() {
	animStartTime = undefined;
	requestAnimationFrame(drawFrame);
}

function drawFrame(time) {
	if (animStartTime === undefined) {
		animStartTime = time;
	}
	const timeDiff = time - animStartTime;
	let steps = 0.5 * gravity * timeDiff * timeDiff / cellSize;
	const opacity = 1 - Math.min(timeDiff / FADE_TIME, 1);
	let doneFalling = false;
	if (steps >= maxAnimLength) {
		steps = maxAnimLength;
		doneFalling = true;
	}
	drawCanvas(steps, opacity);

	const canvas = context.canvas;
	const canvasWidth = canvas.width;
	const canvasHeight = canvas.height;
	for (let i = particles.length - 1; i >= 0; i--) {
		const particle = particles[i];
		const visible = particle.updateAndDraw(context, canvasWidth, canvasHeight, gravity);
		if (!visible) {
			particles.splice(i, 1);
		}
	}

	if (maxAnimLength > 0 && doneFalling) {
		noFade();
		// Shift rows down
		for (let i = 0; i < gridWidth; i++) {
			for (let j = 1; j < gridHeight; j++) {
				const yOffset = animLengthDown[i][j];
				if (yOffset > 0) {
					grid[i][j - yOffset] = grid[i][j];
					const newCell = new Array(gridDepth);
					newCell.fill(CellType.EMPTY);
					grid[i][j] = newCell;
				}
			}
		}
		// Shift columns right
		const middleColNum = Math.trunc(gridWidth / 2) - 1;
		for (let i = middleColNum; i >= 0; i--) {
			const xOffset = animLengthRight[i];
			if (xOffset > 0) {
				grid[i + xOffset] = grid[i];
				const newColumn = new Array(gridHeight);
				grid[i] = newColumn;
				for (let j = 0; j < gridHeight; j++) {
					const newCell = new Array(gridDepth);
					newCell.fill(CellType.EMPTY);
					newColumn[j] = newCell;
				}
			}
		}
		// Shift columns left
		for (let i = middleColNum + 1; i < gridWidth; i++) {
			const xOffset = animLengthRight[i];
			if (xOffset < 0) {
				grid[i + xOffset] = grid[i];
				const newColumn = new Array(gridHeight);
				grid[i] = newColumn;
				for (let j = 0; j < gridHeight; j++) {
					const newCell = new Array(gridDepth);
					newCell.fill(CellType.EMPTY);
					newColumn[j] = newCell;
				}
			}
		}
		noBlocksMoving();
		findTopShapes();
	}
	if (maxAnimLength > 0 || particles.length > 0) {
		requestAnimationFrame(drawFrame);
	}
}

function createExplosion(x, y, depth) {
	const numDivisions = explosionVectors.length;
	const size = boxSize / numDivisions;
	const colorID = grid[x][y][depth - 1] - 1;
	const colorValues = COLORS[colorID];
	const color = `hsla(${colorValues[0]}, ${colorValues[1]}%, ${colorValues[2]}%, 1)`;
	const zHeight = Math.min(gridDepth, MAX_VISIBLE_DEPTH) - depth + 1;
	const left = x * cellSize + zHeight * pxOffset;
	const top = (gridHeight - 1 - y) * cellSize + zHeight * pxOffset;
	for (let i = 0; i < numDivisions; i++) {
		const particleX = left + (i + 0.5) * size;
		for (let j = 0; j < numDivisions; j++) {
			const [velocityX, velocityY] = explosionVectors[i][j];
			if (velocityX !== 0 || velocityY !== 0) {
				const particleY = top + (j + 0.5) * size;
				const particle = new Particle(particleX, particleY, velocityX, velocityY, size, color);
				particles.push(particle);
			}
		}
	}
}

function revealCells(x, y) {
	if (bombNeeded) {

		// This is a simplification of the else part
		let depth = getDepth(grid[x][y]);
		if (depth > 0) {
			createExplosion(x, y, depth);
			maxAnimLength = 1;
			grid[x][y][depth - 1] = CellType.EMPTY;
			depth--;
			bombsUsed++;
			showBombsUsed();
			if (depth === 0) {
				for (let j = y + 1; j < gridHeight; j++) {
					animLengthDown[x][j]++;
				}
				let colorsFound = false;
				for (let j = 0; j < gridHeight; j++) {
					const content = grid[x][j];
					const checkDepth = content[0] === CellType.BLANK ? 1 : 0;
					if (content[checkDepth] >= CellType.COLOR) {
						colorsFound = true;
						break;
					}
				}
				if (!colorsFound) {
					// Erase blanks
					for (let j = 0; j < gridHeight; j++) {
						for (let k = 0; k < gridDepth; k++) {
							grid[x][j][k] = CellType.EMPTY;
						}
					}
					if (x < gridWidth / 2 - 1) {
						for (let k = 0; k < x; k++) {
							animLengthRight[k]++;
						}
					} else {
						for (let k = x + 1; k < gridWidth; k++) {
							animLengthRight[k]--;
						}
					}
				}
			}
			const pan = 0.5 * x / (gridWidth - 1) - 1;
			panSound('smash', pan);
		}

	} else {

		let coordStr = `${x},${y}`;
		for (let n = 0; n < topShapes.length; n++) {
			const shape = topShapes[n];
			if (shape.has(coordStr)) {
				if (shape.size >= minRunLength) {
					maxAnimLength = 1;
					const columns = new Set();
					for (coordStr of shape.values()) {
						const coords = coordStr.split(',', 2);
						x = parseInt(coords[0]);
						y = parseInt(coords[1]);
						let depth = getDepth(grid[x][y]);
						depth--;
						let fade = false;
						if (depth === 0) {
							columns.add(x);
							if (
								y === gridHeight - 1 ||
								grid[x][y + 1][0] === CellType.EMPTY ||
								shape.has(`${x},${y + 1}`)
							) {
								fade = true;
							}
							for (let j = y + 1; j < gridHeight; j++) {
								animLengthDown[x][j]++;
								maxAnimLength = Math.max(maxAnimLength, animLengthDown[x][j]);
							}
						} else {
							fade = true;
							if (depth === 1 && grid[x][y][0] === CellType.BLANK) {
								columns.add(x);
							}
						}
						if (fade) {
							animFade[x][y] = true;
						} else {
							grid[x][y][depth] = CellType.EMPTY;
						}
					}
					for (let i of columns.values()) {
						let colorsFound = false;
						for (let j = 0; j < gridHeight; j++) {
							const content = grid[i][j];
							const checkDepth = animFade[i][j] + (content[0] === CellType.BLANK);
							if (content[checkDepth] >= CellType.COLOR) {
								colorsFound = true;
								break;
							}
						}
						if (!colorsFound) {
							// Erase blanks
							for (let j = 0; j < gridHeight; j++) {
								for (let k = 0; k < gridDepth; k++) {
									grid[i][j][k] = CellType.EMPTY;
								}
							}
							if (i < gridWidth / 2 - 1) {
								for (let k = 0; k < i; k++) {
									animLengthRight[k]++;
									maxAnimLength = Math.max(maxAnimLength, animLengthRight[k]);
								}
							} else {
								for (let k = i + 1; k < gridWidth; k++) {
									animLengthRight[k]--;
									maxAnimLength = Math.max(maxAnimLength, -animLengthRight[k]);
								}
							}
						}

					}
					playSound('laser');
				}
				break;
			}
		}

	}
	animate();
}

document.getElementById('btn-pause').addEventListener('click', function (event) {
	if (timer.paused) {
		timer.start();
	} else {
		timer.pause();
	}
	drawCanvas();
});

document.getElementById('run-length').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 1) {
		minRunLength = value;
		const minShapeSizeInput = document.getElementById('shape-size-min');
		if (minRunLength > parseInt(minShapeSizeInput.value)) {
			minShapeSizeInput.value = minRunLength;
		}
	}
});

document.getElementById('shape-size-min').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 1 && value < minRunLength) {
		minRunLength = value;
		document.getElementById('run-length').value = value;
	}
})

document.getElementById('btn-random-game').addEventListener('click', function (event) {
	newSeed = true;
});

document.getElementById('btn-seed-game').addEventListener('click', function (event) {
	newSeed = false;
});

document.getElementById('game-parameters').addEventListener('submit', function (event) {
	event.preventDefault();
	newGame();
});

document.getElementById('btn-empty').addEventListener('click', function (event) {
	timer.reset();
	emptyGrid();
	drawCanvas();
	random.reset();
	startColumn = Math.trunc(random.next() * gridWidth);
});

document.getElementById('btn-build').addEventListener('click', function (event) {
	noFade();
	noBlocksMoving();
	addShape();
	drawCanvas();
	findTopShapes();
});

context.canvas.addEventListener('click', function (event) {
	if (timer.paused) {
		timer.start();
		drawCanvas();
		return;
	}
	if (maxAnimLength > 0) {
		return;
	}
	timer.start();
	audioContext.resume();
	const x = Math.trunc(event.offsetX / cellSize);
	const y = gridHeight - 1 - Math.trunc(event.offsetY / cellSize);
	revealCells(x, y);
});

function pauseGame() {
	timer.pause();
	drawCanvas();
}

function resumeGame() {
	timer.resume();
	drawCanvas();
}

for (let modal of document.querySelectorAll('.modal')) {
	modal.addEventListener('shown.modal', pauseGame);
	modal.addEventListener('hidden.modal', resumeGame);
}
