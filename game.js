'use strict';
const context = document.getElementById('canvas').getContext('2d');

const CellType = Object.freeze({
	EMPTY: 0,
	BLANK: 1,
	COLOR: 2,
});

const COLORS = [
	'#666666',					// Gray
	'hsl( 15, 100%, 60%)',		// Red
	'hsl(105, 100%, 46%)',		// Green
	'hsl(225, 100%, 62%)',		// Blue
	'hsl( 45, 100%, 60%)',		// Yellow
	'hsl(195, 100%, 60%)',		// Cyan
	'hsl(315, 100%, 72%)',		// Pink
	'hsl(280, 100%, 55%)',		// Purple
	// Shadowed versions
	'#444444',					// Gray
	'hsl( 15, 100%, 40%)',		// Red
	'hsl(105, 100%, 28%)',		// Green
	'hsl(225, 100%, 40%)',		// Blue
	'hsl( 45, 100%, 30%)',		// Yellow
	'hsl(195, 100%, 40%)',		// Cyan
	'hsl(315, 100%, 45%)',		// Pink
	'hsl(280, 100%, 37%)',		// Purple
];

const MAX_VISIBLE_DEPTH = 4;

const ANIM_TIME = 200;

let parentElement = document.body;

let gridWidth, gridHeight, gridDepth, numColors;
let grid, startColumn;
let minShapeSize, maxShapeSize, modalShapeSize, shapeSizeRange;
let minRunLength = parseInt(document.getElementById('run-length').value) || 2;
let blankProbability, dropProbability;
let cellSize, boxSize, cornerSize, pxOffset;
let cellCapacity, totalCapacity;
let random;
let topShapes;
let animLengthDown, animLengthRight, maxAnimLength, animStartTime;

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

function noAnimation() {
	for (let i = 0; i < gridWidth; i++) {
		animLengthDown[i].fill(0);
	}
	animLengthRight.fill(0);
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
	animLengthDown = new Array(gridWidth);
	for (let i = 0; i < gridWidth; i++) {
		const arr = new Array(gridHeight);
		arr.fill(0);
		animLengthDown[i] = arr;
	}
	animLengthRight = new Array(gridWidth);
	animLengthRight.fill(0);
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
function getColor(i, depth) {
	if (depth > 1) {
		const gray = 152 - (depth - 1) * 32;
		return `rgb(${gray}, ${gray}, ${gray})`;
	} else if (depth === 0) {
		return COLORS[i - 1];
	} else {
		return COLORS[i + 7];
	}
}

function chooseCell() {
	let x = Math.trunc(random.next() * gridWidth);
	let y = Math.trunc(random.next() * gridHeight);
	let capacity = cellCapacity[x][y];
	while (capacity === 0) {
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
	if (p < modeMinusMin / shapeSizeRange) {
		return minShapeSize + Math.sqrt(modeMinusMin * shapeSizeRange * p);
	} else {
		return maxShapeSize - Math.sqrt(shapeSizeRange * (maxShapeSize - modalShapeSize) * (1 - p));
	}
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
	if (grid[x][gridHeight - 1][0] === CellType.BLANK) {
		totalCapacity += gridDepth;
	}
	for (let j = gridHeight - 2; j >= y; j--) {
		grid[x][j + 1] = grid[x][j];
		cellCapacity[x][j + 1] = cellCapacity[x][j];
	}
	const content = new Array(gridDepth);
	content.fill(CellType.EMPTY);
	grid[x][y] = content;
	cellCapacity[x][y] = gridDepth;
}

function makeShape() {
	let [x, y] = chooseCell();
	if (cellCapacity[x][y] === gridDepth && random.next() <= blankProbability) {
		grid[x][y][0] = CellType.BLANK;
		cellCapacity[x][y] = 0;
		totalCapacity -= gridDepth;
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
			grid[x][gridHeight - 1][0] < CellType.COLOR;

		if (canShiftUp && random.next() <= dropProbability) {
			shiftUp(x, y);
		}
	}

	for (let coordStr of shapeSet.values()) {
		const coords = coordStr.split(',', 2);
		x = parseInt(coords[0]);
		y = parseInt(coords[1]);
		grid[x][y][getBuiltDepth(x, y)] = color;
		cellCapacity[x][y]--;
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

	const canvas = context.canvas;
	canvas.width = cellSize * gridWidth;
	canvas.height = cellSize * gridHeight;
	context.font = '16px sans-serif';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
}

function drawCell(i, j, xOffset, yOffset, clipLeft, clipRight, clipTop) {
	const content = grid[i][j];
	const depth = getDepth(content);

	const cellLeft = i * cellSize + xOffset;
	const cellTop = (gridHeight - 1 - j) * cellSize + yOffset;
	const startDepth = Math.max(0, depth - MAX_VISIBLE_DEPTH);
	let left, right, top, bottom;

	let zHeight = Math.min(gridDepth, MAX_VISIBLE_DEPTH) - 1;
	for (let k = startDepth; k < depth; k++) {
		left = cellLeft + pxOffset * zHeight;
		right = Math.min(left + boxSize, cellLeft + cellSize - clipRight);
		left = Math.max(left, cellLeft + clipLeft);
		if (left >= right) {
			continue;
		}

		top = cellTop + pxOffset * zHeight;
		bottom = top + boxSize;
		top = Math.max(top, cellTop + clipTop);
		if (top >= bottom) {
			continue;
		}
		context.fillStyle = getColor(content[k], depth - k - 1 - startDepth);
		drawTile(left, right, top, bottom);
		zHeight--;
	}
	if (depth > 0 && content[depth - 1] !== CellType.BLANK) {
		context.fillStyle = '#f4f4f4';
		context.fillText(depth, (left + right) / 2, (top + bottom) / 2);
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

function drawCanvas(animAmount) {
	const canvas = context.canvas;
	context.clearRect(0, 0, canvas.width, canvas.width);
	for (let i = 0; i < gridWidth; i++) {
		if (animLengthRight[i] === 0) {	// Layer these columns first
			for (let j = 0; j < gridHeight; j++) {
				const yOffset = Math.round(Math.min(animAmount, animLengthDown[i][j]) * cellSize);
				drawCell(i, j, 0, yOffset, 0, 0, 0);
			}
		}
	}
	for (let i = 0; i < gridWidth; i++) {
		let rightShift = animLengthRight[i];
		if (rightShift !== 0) {	// These columns drawn on top
			if (rightShift > animAmount) {
				rightShift = animAmount;
			} else if (rightShift < -animAmount) {
				rightShift = -animAmount;
			}
			const xOffset = Math.round(rightShift * cellSize);
			for (let j = 0; j < gridHeight; j++) {
				const yOffset = Math.round(Math.min(animAmount, animLengthDown[i][j]) * cellSize);
				drawCell(i, j, xOffset, yOffset, 0, 0, 0);
			}
		}
	}
}

let newSeed = true;

function newGame() {
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
	blankProbability = parseFloat(document.getElementById('blank-probability').value) / 100;

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
	drawCanvas(0);
	findTopShapes();
}

newGame();

function findTopShapes() {
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
		}
	}
}

function animate(time) {
	if (animStartTime === undefined) {
		animStartTime = time;
	}
	let steps = (time - animStartTime) / ANIM_TIME;
	let done = false;
	if (steps >= maxAnimLength) {
		steps = maxAnimLength;
		done = true;
	}
	drawCanvas(steps);
	if (done) {
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
		noAnimation();
		drawCanvas(0);
		findTopShapes();
	} else {
		requestAnimationFrame(animate);
	}
}

function revealCells(x, y) {
	let coordStr = `${x},${y}`;
	maxAnimLength = 0;
	for (let n = 0; n < topShapes.length; n++) {
		const shape = topShapes[n];
		if (shape.has(coordStr)) {
			if (shape.size >= minRunLength) {
				const columns = new Set();
				for (coordStr of shape.values()) {
					const coords = coordStr.split(',', 2);
					x = parseInt(coords[0]);
					y = parseInt(coords[1]);
					let depth = getDepth(grid[x][y]);
					grid[x][y][depth - 1] = CellType.EMPTY;
					depth--;
					if (depth === 0) {
						columns.add(x);
						for (let j = y + 1; j < gridHeight; j++) {
							animLengthDown[x][j]++;
							maxAnimLength = Math.max(maxAnimLength, animLengthDown[x][j]);
						}
					}
				}
				for (let i of columns.values()) {
					let colorsFound = false;
					for (let j = 0; j < gridHeight; j++) {
						if (grid[i][j][0] >= CellType.COLOR) {
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
			}
			break;
		}
	}
	if (maxAnimLength > 0) {
		animStartTime = undefined;
		requestAnimationFrame(animate);
	} else {
		drawCanvas(0);
		findTopShapes();
	}
}

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
	emptyGrid();
	drawCanvas(0);
	random.reset();
	startColumn = Math.trunc(random.next() * gridWidth);
});

document.getElementById('btn-build').addEventListener('click', function (event) {
	addShape();
	drawCanvas(0);
	findTopShapes();
});

context.canvas.addEventListener('click', function (event) {
	const x = Math.trunc(event.clientX / cellSize);
	const y = gridHeight - 1 - Math.trunc(event.clientY / cellSize);
	revealCells(x, y);
});
