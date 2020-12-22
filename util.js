class RandomNumberGenerator {

	constructor(seed) {
		if (seed === undefined) {
			this.a = Math.floor(Math.random() * 4294967295);
			this.b = Math.floor(Math.random() * 4294967295);
			this.c = Math.floor(Math.random() * 4294967295);
			this.d = Math.floor(Math.random() * 4294967295);
			seed = this.a + '\n' + this.b + '\n' + this.c + '\n' + this.d;
		} else {
			const strings = seed.split('\n', 4);
			this.a = parseInt(strings[0]);
			this.b = parseInt(strings[1]);
			this.c = parseInt(strings[2]);
			this.d = parseInt(strings[3]);
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
