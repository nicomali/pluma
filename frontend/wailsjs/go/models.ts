export namespace main {
	
	export class Settings {
	    recent: string[];
	    zoom: number;
	    sidebarOpen: boolean;
	    editMode: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.recent = source["recent"];
	        this.zoom = source["zoom"];
	        this.sidebarOpen = source["sidebarOpen"];
	        this.editMode = source["editMode"];
	    }
	}

}

