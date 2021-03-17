export default class Particle {
	constructor(x, y, velocityX, startVelocityY, size, color) {
		this.startX = x;
		this.startY = y;
		this.velocityX = velocityX;
		this.startVelocityY = startVelocityY;
		this.size = size;
		this.color = color;
		this.time = 0;
	}

	updateAndDraw(context, width, height, gravity) {
		this.time++;
		const time = this.time;
		const x = this.startX + this.velocityX * time;
		const y = this.startY + this.startVelocityY * time + 0.5 * gravity * time * time;
		const radius = this.size / 2;
		const visible =  x > -radius && x < width + radius && y > -radius && y < height + radius;
		if (visible) {
			context.fillStyle = this.color;
			const size = this.size;
			context.fillRect(x - radius, y - radius, size, size);
		}
		return visible;
	}

}
