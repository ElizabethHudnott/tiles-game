class RandomNumberGenerator {

	constructor(seed) {
		if (seed === undefined) {
			this.a = Math.floor(Math.random() * 4294967296);
			this.b = Math.floor(Math.random() * 4294967296);
			this.c = Math.floor(Math.random() * 4294967296);
			this.d = Math.floor(Math.random() * 4294967296);
			seed = (
				Math.trunc(this.a / 2).toString(36).padStart(6, '0') +
				Math.trunc(this.b / 2).toString(36).padStart(6, '0') +
				Math.trunc(this.c / 2).toString(36).padStart(6, '0') +
				Math.trunc(this.d / 2).toString(36).padStart(6, '0') +
				(this.a % 2 + (this.b % 2) * 2 + (this.c % 2) * 4 + (this.d % 2) * 8).toString(16)
			).toUpperCase();
		} else {
			this.a = parseInt(seed.slice(0, 6), 36) * 2;
			this.b = parseInt(seed.slice(6, 12), 36) * 2;
			this.c = parseInt(seed.slice(12, 18), 36) * 2;
			this.d = parseInt(seed.slice(18, 24), 36) * 2;
			let lsbs = parseInt(seed[24], 16);
			this.a += lsbs & 1;
			lsbs >>= 1;
			this.b += lsbs & 1;
			lsbs >>= 1;
			this.c += lsbs & 1;
			lsbs >>= 1;
			this.d += lsbs;
		}
		this.originalA = this.a;
		this.originalB = this.b;
		this.originalC = this.c;
		this.originalD = this.d;
		this.seed = seed;
	}

	next() {
		const t = this.b << 9;
		let r = this.a * 5;
		r = (r << 7 | r >>> 25) * 9;
		this.c ^= this.a;
		this.d ^= this.b;
		this.b ^= this.c;
		this.a ^= this.d;
		this.c ^= t;
		this.d = this.d << 11 | this.d >>> 21;
		return (r >>> 0) / 4294967296;
	}

	reset() {
		this.a = this.originalA;
		this.b = this.originalB;
		this.c = this.originalC;
		this.d = this.originalD;
	}

}
