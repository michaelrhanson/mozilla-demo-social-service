#!/usr/bin/python
from os import unlink, mkdir, chdir, system, unlink
from os.path import abspath, join, dirname, exists
from shutil import copy, copytree, rmtree

this_dir = dirname(__file__)
service_path = abspath(join(this_dir, "../mozilla-demo-social-service"))
social_path = abspath(join(this_dir, "../socialapi-dev"))
stage_path = abspath(join(this_dir, "stage"))
xpi_name = abspath(join(this_dir, "mozillademo-socialapi-dev.xpi"))

if exists(stage_path):
    rmtree(stage_path)
mkdir(stage_path)
if exists(xpi_name):
    unlink(xpi_name)

copy(join(social_path, "chrome.manifest"), stage_path)
copytree(join(social_path, "components"), join(stage_path, "components"))
copytree(join(social_path, "content"), join(stage_path, "content"))
copytree(join(social_path, "modules"), join(stage_path, "modules"))
copytree(join(social_path, "skin"), join(stage_path, "skin"))
copy(join(social_path, "install.rdf"), stage_path)
copytree(join(service_path, "providers"), join(stage_path, "providers"))

chdir(stage_path)
system("patch -p1 < ../defaultServices.patch")
system("zip -q -r " + xpi_name + " *")
print "Created", xpi_name
