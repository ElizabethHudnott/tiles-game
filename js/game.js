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

// Status codes when trying to add a cell onto an existing shape
const Conflict = Object.freeze({
	NONE: 0,			// Okay
	FULL: 1,			// Cell cannot hold any more tiles
	ALREADY_ADDED: 2,	// Shape already occupies the queried cell
	FLOATING: 3,		// Would leave a tile floating mid air
	MERGE: 4,			// Would cause the shape to another shape with the same colour
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

function initialValue(id, parser) {
	const input = document.getElementById(id);
	let value = parser(input.value);
	if (!value && value !== 0) {
		input.value = input.defaultValue;
		value = parser(input.defaultValue);
	}
	return value;
}

let parentElement = document.body;
let gravity;
let gridWidth, gridHeight, gridDepth, numColors;
let grid, startColumn;
let minShapeSize = initialValue('shape-size-min', parseInt);
let modalShapeSize = initialValue('shape-size-mode', parseInt);
let maxShapeSize = initialValue('shape-size-max', parseInt);
let shapeSizeRange, minRunLength, blankProportion, colorOverBlank, dropProbability;
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

function encodeDifficulty() {
	let str = (gridWidth - 2).toString(36);
	str += (gridHeight - 2).toString(36);
	let number = (gridDepth - 2) + ((numColors - 4) << 2) + ((Math.min(minRunLength, 5) - 2) << 4);
	str += number.toString(36);
	return str.toUpperCase();
}

function encodeLevel() {
	return encodeDifficulty() + '-' + random.seed;
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

/** Returns whether or not a shape can be expanded into a particular cell, if not then
 *	which cells would cause a merger with another shape, and which cells need to be added.
 */
function canExpand(x, y, shapeSet, color, merges = new Set(), additions = new Set()) {
	if (cellCapacity[x][y] === 0) {
		return [Conflict.FULL, merges, additions];
	}
	if (shapeSet.has(`${x},${y}`)) {
		return [Conflict.ALREADY_ADDED, merges, additions];
	}
	additions.add(`${x},${y}`);
	let depth;
	if (x > 0) {
		depth = getBuiltDepth(x - 1, y);
		if (grid[x - 1][y][depth - 1] === color) {
			merges.add(`${x - 1},${y}`);
		}
	}
	if (x < gridWidth - 1) {
		depth = getBuiltDepth(x + 1, y);
		if (grid[x + 1][y][depth - 1] === color) {
			merges.add(`${x + 1},${y}`);
		}
	}
	if (y > 0) {
		depth = getBuiltDepth(x, y - 1);
		if (grid[x][y - 1][depth - 1] === color) {
			merges.add(`${x},${y - 1}`);
		}
	}
	if (y < gridHeight - 1) {
		depth = getBuiltDepth(x, y + 1);
		if (grid[x][y + 1][depth - 1] === color) {
			merges.add(`${x},${y + 1}`);
		}
	}

	if (y > 0 && grid[x][y - 1][0] === CellType.EMPTY) {
		// Can't be floating mid air.
		const newShape = new Set(shapeSet);
		newShape.add(`${x},${y}`);
		canExpand(x, y - 1, newShape, color, merges, additions);
	}

	const status = merges.size === 0 ? Conflict.NONE : Conflict.MERGE;
	return [status, merges, additions];

}

function addExpansion(set, additions) {
	let str = 'E,';
	for (let addition of additions) {
		str += addition + ',';
	}
	set.add(str.slice(0, -1));
}

function addOptions(x, y, shapeSet, color, targetSize, options) {
	if (x > 0) {
		const [status, , additions] = canExpand(x - 1, y, shapeSet, color);
		if (status === Conflict.NONE && shapeSet.size + additions.size <= targetSize) {
			addExpansion(options, additions);
		}
	}
	if (x < gridWidth - 1) {
		const [status, , additions] = canExpand(x + 1, y, shapeSet, color);
		if (status === Conflict.NONE && shapeSet.size + additions.size <= targetSize) {
			addExpansion(options, additions);
		}
	}
	if (y > 0) {
		const [status, , additions] = canExpand(x, y - 1, shapeSet, color);
		if (status === Conflict.NONE && shapeSet.size + additions.size <= targetSize) {
			addExpansion(options, additions);
		}
	}
	if (y < gridHeight - 1) {
		const [status, , additions] = canExpand(x, y + 1, shapeSet, color);
		if (status === Conflict.NONE && shapeSet.size + additions.size <= targetSize) {
			addExpansion(options, additions);
		}
	}
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
	if (y === 0 && (
		(x > 0 && grid[x - 1][0][0] === CellType.BLANK) ||
		(x < gridWidth - 1 && grid[x + 1][0][0] === CellType.BLANK)
	)) {
		return false;
	}
	if (y === gridHeight - 1 || grid[x][y][0] === CellType.BLANK) {
		return false;
	}
	const capacity = cellCapacity[x][y];
	const sufficentCapacity = colorOverBlank ? capacity > 0 : capacity === gridDepth;
	if (!sufficentCapacity) {
		return false;
	}
	return true;
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

	const targetSize = chooseShapeSize();
	const options = new Set();
	addOptions(x, y, shapeSet, color, targetSize, options);
	const highest = new Map();
	highest.set(x, y);

	while (shapeSet.size < targetSize && options.size > 0) {
		if (options.size > 0) {
			const index = Math.trunc(random.next() * options.size);
			let i = 0;
			for (let value of options.values()) {
				if (index === i) {
					const params = value.split(',');
					for (let j = 1; j < params.length - 1; j += 2) {
						x = parseInt(params[j]);
						y = parseInt(params[j + 1]);
						options.delete(value);
						shapeSet.add(`${x},${y}`);
						addOptions(x, y, shapeSet, color, targetSize, options);
						const highestInColumn = highest.get(x);
						if (highestInColumn === undefined || y > highestInColumn) {
							highest.set(x, y);
						}
					}
					break;
				}
				i++;
			}
		} else {
			break;
		}

	};

	if (shapeSet.size < minShapeSize) {
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
	document.getElementById('btn-build').disabled = true;

	gridWidth = parseInt(document.getElementById('grid-width').value);
	gridHeight = parseInt(document.getElementById('grid-height').value);
	gridDepth = parseInt(document.getElementById('grid-depth').value);
	numColors = parseInt(document.getElementById('num-colors').value);

	shapeSizeRange = maxShapeSize - minShapeSize;

	dropProbability = parseFloat(document.getElementById('drop-probability').value) / 100;
	blankProportion = parseFloat(document.getElementById('blank-percentage').value) / 100;
	colorOverBlank = document.getElementById('color-over-blank').checked;

	minRunLength = minShapeSize;
	document.getElementById('run-length').innerHTML = minRunLength;
	document.getElementById('btn-reduce-run-length').disabled = minRunLength === 2;

	const seedInput = document.getElementById('random-seed');
	const seedStr = seedInput.value.toUpperCase();
	if (!newSeed && /^[0-9A-Z]{24}[0-9A-F]$/.test(seedStr)) {
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
	console.log(encodeLevel());
}

newGame();

function showBombsUsed() {
	document.getElementById('bombs-used').innerHTML = bombsUsed;
}

function findTopShapes(shapeAdded = false) {
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
	if (topShapes.length === 0 && !shapeAdded) {
		timer.stop();
		setBombNeeded(false);
		document.getElementById('bombs-used-complete').innerHTML = bombsUsed;
		document.getElementById('time-taken').innerHTML = document.getElementById('timer').innerHTML;
		const objectiveText = bombsUsed === 0 ? '' : 'using fewer bombs or';
		document.getElementById('objective').innerHTML = objectiveText;
		Components.openModal('completed-modal');
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
				for (let j = gridHeight - 1; j >= 0; j--) {
					const content = grid[x][j];
					const checkDepth = content[0] === CellType.BLANK ? 1 : 0;
					if (content[checkDepth] >= CellType.COLOR) {
						colorsFound = true;
						break;
					}
					animFade[x][j] = true;
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
						for (let j = gridHeight - 1; j >= 0; j--) {
							const content = grid[i][j];
							const checkDepth = animFade[i][j] + (content[0] === CellType.BLANK);
							if (content[checkDepth] >= CellType.COLOR) {
								colorsFound = true;
								break;
							}
							animFade[i][j] = true;
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

document.getElementById('btn-reduce-run-length').addEventListener('click', function (event) {
	minRunLength--;
	document.getElementById('run-length').innerHTML = minRunLength;
	this.disabled = minRunLength === 2;
});

document.getElementById('shape-size-min').addEventListener('input', function (event) {
	this.setCustomValidity('');
	const value = parseInt(this.value);
	if (Number.isFinite(value)) {
		minShapeSize = value;
		if (modalShapeSize >= minShapeSize && modalShapeSize <= maxShapeSize) {
			document.getElementById('shape-size-mode').setCustomValidity('');
		}
	}
});

document.getElementById('shape-size-mode').addEventListener('input', function (event) {
	this.setCustomValidity('');
	const value = parseInt(this.value);
	if (Number.isFinite(value)) {
		modalShapeSize = value;
	}
});

document.getElementById('shape-size-max').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (Number.isFinite(value)) {
		maxShapeSize = value;
		if (minShapeSize <= maxShapeSize) {
			document.getElementById('min-shape-size').setCustomValidity('');
		}
		if (modalShapeSize >= minShapeSize && modalShapeSize <= maxShapeSize) {
			document.getElementById('shape-size-mode').setCustomValidity('');
		}
	}
});

document.getElementById('btn-random-game').addEventListener('click', function (event) {
	newSeed = true;
});

document.getElementById('btn-seed-game').addEventListener('click', function (event) {
	newSeed = false;
});

document.getElementById('game-parameters').addEventListener('submit', function (event) {
	event.preventDefault();
	const minShapeSizeInput = document.getElementById('shape-size-min');
	const modalShapeSizeInput = document.getElementById('shape-size-mode');
	if (minShapeSize > maxShapeSize) {
		minShapeSizeInput.setCustomValidity('Minimum cannot be greater than the maximum.')
	} else {
		minShapeSizeInput.setCustomValidity('');
	}
	if (modalShapeSize < minShapeSize) {
		modalShapeSizeInput.setCustomValidity('Mode cannot be less than the minimum.')
	} else if (modalShapeSize > maxShapeSize) {
		modalShapeSizeInput.setCustomValidity('Mode cannot be greater than maximum.')
	} else {
		modalShapeSizeInput.setCustomValidity('');
	}
	if (this.reportValidity()) {
		newGame();
	}
});

document.getElementById('btn-empty').addEventListener('click', function (event) {
	timer.reset();
	emptyGrid();
	drawCanvas();
	document.getElementById('btn-build').disabled = false;
	random.reset();
	startColumn = Math.trunc(random.next() * gridWidth);
});

document.getElementById('btn-build').addEventListener('click', function (event) {
	noFade();
	noBlocksMoving();
	const success = addShape();
	drawCanvas();
	findTopShapes(true);
	if (!success) {
		this.disabled = true;
		timer.start();
	}
});

document.getElementById('btn-next-level').addEventListener('click', function (event) {
	Components.closeModal();
	newGame();
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
	modal.addEventListener('show.modal', pauseGame);
	modal.addEventListener('hidden.modal', resumeGame);
}
